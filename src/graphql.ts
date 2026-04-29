import { GitHubError, type Env } from "./github.js";

export async function ghql<T = unknown>(
  env: Env,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_PAT}`,
      "Content-Type": "application/json",
      "User-Agent": "github-mcp-worker",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new GitHubError(r.status, await r.text());
  const json = await r.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join("; "));
  return json.data as T;
}
