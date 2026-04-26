import type { Env } from "./github.js";
import { tools, handlers } from "./tools.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "github-mcp-worker", version: "0.1.0" };

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

function rpcError(id: string | number | null, code: number, message: string): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRpc(msg: JsonRpcRequest, env: Env): Promise<JsonRpcResponse> {
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools } };

    case "tools/call": {
      const params = msg.params ?? {};
      const name = params.name;
      const args = (params.arguments as Record<string, unknown> | undefined) ?? {};
      if (typeof name !== "string") return rpcError(id, -32602, "Missing tool name");
      const handler = handlers[name];
      if (!handler) return rpcError(id, -32602, `Unknown tool: ${name}`);
      try {
        const data = await handler(env, args);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          },
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: message }],
            isError: true,
          },
        };
      }
    }

    case "ping":
      return { jsonrpc: "2.0", id, result: {} };

    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
    if (req.method === "GET") return withCors(new Response("github-mcp-worker", { status: 200 }));
    if (req.method !== "POST") return withCors(new Response("Method Not Allowed", { status: 405 }));

    if (!env.WORKER_TOKEN || !env.GITHUB_PAT) {
      return withCors(new Response("Worker secrets not configured", { status: 500 }));
    }
    if (req.headers.get("Authorization") !== `Bearer ${env.WORKER_TOKEN}`) {
      return withCors(new Response("Unauthorized", { status: 401 }));
    }

    let msg: JsonRpcRequest;
    try {
      msg = (await req.json()) as JsonRpcRequest;
    } catch {
      return withCors(Response.json(rpcError(null, -32700, "Parse error")));
    }

    // Notifications (no `id`) get 202 Accepted with empty body.
    if (msg.id === undefined || msg.id === null) {
      return withCors(new Response(null, { status: 202 }));
    }

    const response = await handleRpc(msg, env);
    return withCors(Response.json(response));
  },
};
