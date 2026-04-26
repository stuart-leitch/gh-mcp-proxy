import type { Env } from "./github.js";
import * as issues from "./handlers/issues.js";
import * as files from "./handlers/files.js";
import * as repos from "./handlers/repos.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const tools: ToolDef[] = [
  {
    name: "list_issues",
    description: "List issues in a repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
        labels: { type: "string", description: "Comma-separated label names." },
        per_page: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "get_issue",
    description: "Get a single issue by number.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        issue_number: { type: "integer" },
      },
      required: ["owner", "repo", "issue_number"],
    },
  },
  {
    name: "create_issue",
    description: "Create a new issue.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
      },
      required: ["owner", "repo", "title"],
    },
  },
  {
    name: "update_issue",
    description: "Update title, body, state, or labels of an existing issue.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        issue_number: { type: "integer" },
        title: { type: "string" },
        body: { type: "string" },
        state: { type: "string", enum: ["open", "closed"] },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["owner", "repo", "issue_number"],
    },
  },
  {
    name: "get_file",
    description: "Read a file from a repository. Returns decoded UTF-8 contents.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        path: { type: "string" },
        ref: { type: "string", description: "Branch, tag, or commit SHA. Defaults to the repo's default branch." },
      },
      required: ["owner", "repo", "path"],
    },
  },
  {
    name: "list_directory",
    description: "List entries in a directory of a repository (one level). Pass empty path for the repo root.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        path: { type: "string", description: "Directory path. Empty string or omitted for repo root." },
        ref: { type: "string", description: "Branch, tag, or commit SHA. Defaults to the repo's default branch." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "list_tree",
    description: "Recursively list every file and directory in a repository at a given ref. Optionally filter by path prefix.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        ref: { type: "string", description: "Branch, tag, or commit SHA. Defaults to the repo's default branch." },
        path: { type: "string", description: "Optional path prefix to filter by, e.g. 'docs'." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "create_or_update_file",
    description: "Create or update a file in a repository. SHA is fetched automatically when updating.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        path: { type: "string" },
        content: { type: "string", description: "File contents as UTF-8 text." },
        message: { type: "string", description: "Commit message." },
        branch: { type: "string", description: "Branch to commit on. Defaults to the repo's default branch." },
      },
      required: ["owner", "repo", "path", "content", "message"],
    },
  },
  {
    name: "list_repos",
    description: "List repositories the PAT has access to.",
    inputSchema: {
      type: "object",
      properties: {
        per_page: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        sort: { type: "string", enum: ["created", "updated", "pushed", "full_name"], default: "updated" },
      },
    },
  },
];

type Handler = (env: Env, args: Record<string, unknown>) => Promise<unknown>;

export const handlers: Record<string, Handler> = {
  list_issues: issues.list,
  get_issue: issues.get,
  create_issue: issues.create,
  update_issue: issues.update,
  get_file: files.get,
  list_directory: files.list,
  list_tree: files.tree,
  create_or_update_file: files.createOrUpdate,
  list_repos: repos.list,
};
