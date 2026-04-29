import type { Env } from "./github.js";
import * as issues from "./handlers/issues.js";
import * as files from "./handlers/files.js";
import * as repos from "./handlers/repos.js";
import * as projects from "./handlers/projects.js";

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
  {
    name: "list_projects",
    description: "List GitHub Projects v2 for a user or organisation.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "GitHub username or organisation login." },
      },
      required: ["owner"],
    },
  },
  {
    name: "list_project_items",
    description: "List items in a GitHub Project v2 board, optionally filtered by status column.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The node ID of the project (e.g. PVT_...)." },
        status: { type: "string", description: "Filter to items with this Status value (e.g. 'Backlog', 'In Progress')." },
        per_page: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      required: ["project_id"],
    },
  },
  {
    name: "get_project_item",
    description: "Get full details for a single item in a GitHub Project v2.",
    inputSchema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "The node ID of the project item (e.g. PVTI_...)." },
      },
      required: ["item_id"],
    },
  },
  {
    name: "update_project_item_status",
    description: "Move a project item to a different status column (e.g. Backlog → In Progress).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The node ID of the project." },
        item_id: { type: "string", description: "The node ID of the project item." },
        status: { type: "string", description: "The target status column name (e.g. 'In Progress', 'Done')." },
      },
      required: ["project_id", "item_id", "status"],
    },
  },
  {
    name: "add_issue_to_project",
    description: "Add an issue to a GitHub Project v2 board, optionally setting its initial status column.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The node ID of the project." },
        issue_url: { type: "string", description: "The GitHub issue URL (https://github.com/owner/repo/issues/123) or issue node ID." },
        status: { type: "string", description: "Optional initial status column (e.g. 'Backlog')." },
      },
      required: ["project_id", "issue_url"],
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
  create_or_update_file: files.createOrUpdate,
  list_repos: repos.list,
  list_projects: projects.listProjects,
  list_project_items: projects.listProjectItems,
  get_project_item: projects.getProjectItem,
  update_project_item_status: projects.updateProjectItemStatus,
  add_issue_to_project: projects.addIssueToProject,
};
