import { gh, GitHubError, type Env } from "../github.js";

function req(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`missing required string arg: ${key}`);
  return v;
}

function decodeBase64Utf8(b64: string): string {
  const clean = b64.replace(/\n/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

interface ContentFile {
  type: string;
  encoding?: string;
  content?: string;
  sha: string;
  path: string;
  size: number;
}

export async function get(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const owner = req(args, "owner");
  const repo = req(args, "repo");
  const path = req(args, "path");
  const params = new URLSearchParams();
  if (typeof args.ref === "string") params.set("ref", args.ref);
  const qs = params.toString() ? `?${params}` : "";
  const file = await gh<ContentFile>(env, `/repos/${owner}/${repo}/contents/${encodeURI(path)}${qs}`);
  if (file.type !== "file" || file.encoding !== "base64" || file.content === undefined) {
    throw new Error(`path is not a regular file: ${path} (type=${file.type})`);
  }
  return {
    path: file.path,
    sha: file.sha,
    size: file.size,
    content: decodeBase64Utf8(file.content),
  };
}

export async function createOrUpdate(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const owner = req(args, "owner");
  const repo = req(args, "repo");
  const path = req(args, "path");
  const content = req(args, "content");
  const message = req(args, "message");
  const branch = typeof args.branch === "string" ? args.branch : undefined;

  const lookupParams = new URLSearchParams();
  if (branch) lookupParams.set("ref", branch);
  const lookupQs = lookupParams.toString() ? `?${lookupParams}` : "";

  let sha: string | undefined;
  try {
    const existing = await gh<ContentFile>(env, `/repos/${owner}/${repo}/contents/${encodeURI(path)}${lookupQs}`);
    sha = existing.sha;
  } catch (e) {
    if (!(e instanceof GitHubError) || e.status !== 404) throw e;
  }

  const body: Record<string, unknown> = {
    message,
    content: encodeBase64Utf8(content),
  };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;

  return gh(env, `/repos/${owner}/${repo}/contents/${encodeURI(path)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
