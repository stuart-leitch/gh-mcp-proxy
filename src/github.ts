export interface Env {
  GITHUB_PAT: string;
  WORKER_TOKEN: string;
  TOKEN_SIGNING_SECRET?: string;
}

export class GitHubError extends Error {
  constructor(public status: number, public body: string) {
    super(`GitHub ${status}: ${body}`);
  }
}

export async function gh<T = unknown>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${env.GITHUB_PAT}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Accept": "application/vnd.github+json",
    "User-Agent": "github-mcp-worker",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.headers) Object.assign(headers, init.headers);

  const r = await fetch(`https://api.github.com${path}`, { ...init, headers });
  if (!r.ok) throw new GitHubError(r.status, await r.text());
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}
