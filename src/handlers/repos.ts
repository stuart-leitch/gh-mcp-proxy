import { gh, type Env } from "../github.js";

interface Repo {
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  updated_at: string;
}

export async function list(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const perPage = (args.per_page as number) ?? 50;
  const sort = (args.sort as string) ?? "updated";
  const params = new URLSearchParams({ per_page: String(perPage), sort });
  const repos = await gh<Repo[]>(env, `/user/repos?${params}`);
  return repos.map((r) => ({
    full_name: r.full_name,
    private: r.private,
    description: r.description,
    default_branch: r.default_branch,
    updated_at: r.updated_at,
  }));
}
