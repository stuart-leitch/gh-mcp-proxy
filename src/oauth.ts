import type { Env } from "./github.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

interface CodeClaims {
  kind: "code";
  redirect_uri: string;
  code_challenge: string;
  exp: number;
}

interface AccessClaims {
  kind: "access";
  exp: number;
}

interface RefreshClaims {
  kind: "refresh";
  exp: number;
}

const CODE_TTL_SECONDS = 300;
const ACCESS_TTL_SECONDS = 3600;         // 1 hour
const REFRESH_TTL_SECONDS = 30 * 86400; // 30 days

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  // Use TOKEN_SIGNING_SECRET when set so rotating WORKER_TOKEN doesn't
  // invalidate existing tokens. Falls back to WORKER_TOKEN for deployments
  // that haven't yet set the dedicated secret.
  const secret = env.TOKEN_SIGNING_SECRET ?? env.WORKER_TOKEN;
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(claims: CodeClaims | AccessClaims | RefreshClaims, env: Env): Promise<string> {
  const key = await hmacKey(env);
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

async function verifyStamp<T extends { kind: string; exp: number }>(
  stamp: string,
  env: Env,
  expectedKind: T["kind"],
): Promise<T | null> {
  const dot = stamp.indexOf(".");
  if (dot < 0) return null;
  const payload = stamp.slice(0, dot);
  const sig = stamp.slice(dot + 1);
  const key = await hmacKey(env);
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(sig), enc.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  let claims: T;
  try {
    claims = JSON.parse(dec.decode(b64urlDecode(payload))) as T;
  } catch {
    return null;
  }
  if (claims.kind !== expectedKind) return null;
  // Allow 60 s of clock skew across Cloudflare's distributed edge.
  if (claims.exp + 60 < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

async function sha256B64Url(s: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return b64url(hash);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function protectedResourceMetadata(origin: string): unknown {
  return {
    resource: origin,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(origin: string): unknown {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export function handleAuthorizeGet(url: URL): Response {
  const params = url.searchParams;
  const redirect_uri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";
  const code_challenge = params.get("code_challenge") ?? "";
  const code_challenge_method = params.get("code_challenge_method") ?? "";
  const response_type = params.get("response_type") ?? "";

  if (response_type !== "code") return new Response("response_type must be 'code'", { status: 400 });
  if (code_challenge_method !== "S256") return new Response("code_challenge_method must be 'S256'", { status: 400 });
  if (!code_challenge) return new Response("code_challenge required", { status: 400 });
  if (!/^https:\/\//.test(redirect_uri)) return new Response("redirect_uri must be https", { status: 400 });

  const html = `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>github-mcp-worker</title>
<style>
  body { font-family: -apple-system,system-ui,sans-serif; margin: 3rem auto; max-width: 24rem; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.25rem; }
  p { color: #555; }
  input[type=password] { width: 100%; padding: 0.6rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
  button { width: 100%; padding: 0.75rem; font-size: 1rem; margin-top: 1rem; border: 0; border-radius: 6px; background: #111; color: #fff; }
  label { display: block; margin-top: 1rem; font-size: 0.9rem; }
  code { background: #f3f3f3; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.85em; }
</style></head><body>
<h1>github-mcp-worker</h1>
<p>Paste the worker master password (your <code>WORKER_TOKEN</code>) to authorize this client.</p>
<form method="POST" action="/oauth/authorize">
  <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}">
  <input type="hidden" name="state" value="${escapeHtml(state)}">
  <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}">
  <label>Master password<input type="password" name="master_password" autofocus autocomplete="current-password"></label>
  <button type="submit">Authorize</button>
</form>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function handleAuthorizePost(req: Request, env: Env): Promise<Response> {
  const form = await req.formData();
  const redirect_uri = String(form.get("redirect_uri") ?? "");
  const state = String(form.get("state") ?? "");
  const code_challenge = String(form.get("code_challenge") ?? "");
  const master_password = String(form.get("master_password") ?? "");

  if (master_password !== env.WORKER_TOKEN) {
    return new Response("Wrong master password", { status: 401, headers: { "Content-Type": "text/plain" } });
  }
  if (!/^https:\/\//.test(redirect_uri)) return new Response("Bad redirect_uri", { status: 400 });
  if (!code_challenge) return new Response("Missing code_challenge", { status: 400 });

  const code = await sign(
    {
      kind: "code",
      redirect_uri,
      code_challenge,
      exp: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS,
    },
    env,
  );

  const target = new URL(redirect_uri);
  target.searchParams.set("code", code);
  if (state) target.searchParams.set("state", state);
  return Response.redirect(target.toString(), 302);
}

export async function handleToken(req: Request, env: Env): Promise<Response> {
  const ct = req.headers.get("Content-Type") ?? "";
  let params: URLSearchParams;
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await req.text());
  } else if (ct.includes("application/json")) {
    const body = (await req.json()) as Record<string, string>;
    params = new URLSearchParams(body);
  } else {
    return Response.json({ error: "invalid_request", error_description: "unsupported content-type" }, { status: 400 });
  }

  const grant_type = params.get("grant_type") ?? "";

  // --- refresh_token grant ---
  if (grant_type === "refresh_token") {
    const refresh_token = params.get("refresh_token") ?? "";
    const refreshClaims = await verifyStamp<RefreshClaims>(refresh_token, env, "refresh");
    if (!refreshClaims) return Response.json({ error: "invalid_grant" }, { status: 400 });
    return issueTokenPair(env);
  }

  // --- authorization_code grant ---
  if (grant_type !== "authorization_code") {
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }
  const code = params.get("code") ?? "";
  const redirect_uri = params.get("redirect_uri") ?? "";
  const code_verifier = params.get("code_verifier") ?? "";

  const claims = await verifyStamp<CodeClaims>(code, env, "code");
  if (!claims) return Response.json({ error: "invalid_grant" }, { status: 400 });
  if (claims.redirect_uri !== redirect_uri) {
    return Response.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, { status: 400 });
  }
  const expected = await sha256B64Url(code_verifier);
  if (expected !== claims.code_challenge) {
    return Response.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, { status: 400 });
  }

  return issueTokenPair(env);
}

async function issueTokenPair(env: Env): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const access_token = await sign({ kind: "access", exp: now + ACCESS_TTL_SECONDS }, env);
  const refresh_token = await sign({ kind: "refresh", exp: now + REFRESH_TTL_SECONDS }, env);
  return Response.json({
    access_token,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token,
  });
}

export async function handleRegister(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { redirect_uris?: unknown };
  return Response.json(
    {
      client_id: "github-mcp-worker",
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: Array.isArray(body.redirect_uris) ? body.redirect_uris : [],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}

export async function isValidAccess(token: string, env: Env): Promise<boolean> {
  const claims = await verifyStamp<AccessClaims>(token, env, "access");
  return claims !== null;
}
