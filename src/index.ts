import type { Env } from "./github.js";
import { tools, handlers } from "./tools.js";
import {
  protectedResourceMetadata,
  authorizationServerMetadata,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleToken,
  handleRegister,
  isValidAccess,
} from "./oauth.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "github-mcp-worker", version: "0.1.0" };

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
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

function unauthorizedChallenge(origin: string): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer realm="github-mcp-worker", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    },
  });
}

async function handleMcp(req: Request, env: Env, origin: string): Promise<Response> {
  if (!env.WORKER_TOKEN || !env.GITHUB_PAT) {
    return new Response("Worker secrets not configured", { status: 500 });
  }
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !(await isValidAccess(token, env))) {
    return unauthorizedChallenge(origin);
  }

  let msg: JsonRpcRequest;
  try {
    msg = (await req.json()) as JsonRpcRequest;
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"));
  }

  // Notifications (no `id`) get 202 Accepted with empty body.
  if (msg.id === undefined || msg.id === null) {
    return new Response(null, { status: 202 });
  }

  const response = await handleRpc(msg, env);
  return Response.json(response);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;

    if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

    // Discovery endpoints (RFC 9728 + RFC 8414)
    if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
      return withCors(Response.json(protectedResourceMetadata(origin)));
    }
    if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      return withCors(Response.json(authorizationServerMetadata(origin)));
    }

    // OAuth endpoints
    if (url.pathname === "/oauth/register" && req.method === "POST") {
      return withCors(await handleRegister(req));
    }
    if (url.pathname === "/oauth/authorize" && req.method === "GET") {
      return handleAuthorizeGet(url);
    }
    if (url.pathname === "/oauth/authorize" && req.method === "POST") {
      return handleAuthorizePost(req, env);
    }
    if (url.pathname === "/oauth/token" && req.method === "POST") {
      return withCors(await handleToken(req, env));
    }

    // MCP endpoint: accept POST at root or /mcp
    if (req.method === "POST" && (url.pathname === "/" || url.pathname === "/mcp")) {
      return withCors(await handleMcp(req, env, origin));
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/mcp")) {
      return withCors(new Response("github-mcp-worker", { status: 200 }));
    }

    return withCors(new Response("Not Found", { status: 404 }));
  },
};
