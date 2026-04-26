import { gh, type Env } from "../github.js";

function req(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`missing required string arg: ${key}`);
  return v;
}

function reqInt(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`missing required integer arg: ${key}`);
  return v;
}

export async function list(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const owner = req(args, "owner");
  const repo = req(args, "repo");
  const state = (args.state as string) ?? "open";
  const perPage = (args.per_page as number) ?? 50;
  const params = new URLSearchParams({ state, per_page: String(perPage) });
  if (typeof args.labels === "string") params.set("labels", args.labels);
  return gh(env, `/repos/${owner}/${repo}/issues?${params}`);
}

export async function get(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const owner = req(args, "owner");
  const repo = req(args, "repo");
  const number = reqInt(args, "issue_number");
  return gh(env, `/repos/${owner}/${repo}/issues/${number}`);
}

export async function create(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const owner = req(args, "owner");
  const repo = req(args, "repo");
  const body: Record<string, unknown> = { title: req(args, "title") };
  if (typeof args.body === "string") body.body = args.body;
  if (Array.isArray(args.labels)) body.labels = args.labels;
  if (Array.isArray(args.assignees)) body.assignees = args.assignees;
  return gh(env, `/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function update(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const owner = req(args, "owner");
  const repo = req(args, "repo");
  const number = reqInt(args, "issue_number");
  const body: Record<string, unknown> = {};
  for (const k of ["title", "body", "state"] as const) {
    if (typeof args[k] === "string") body[k] = args[k];
  }
  if (Array.isArray(args.labels)) body.labels = args.labels;
  return gh(env, `/repos/${owner}/${repo}/issues/${number}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
