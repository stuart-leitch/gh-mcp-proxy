import { gh, type Env } from "../github.js";
import { ghql } from "../graphql.js";

function req(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`missing required string arg: ${key}`);
  return v;
}

const FIELD_VALUES_FRAGMENT = `
  fieldValues(first: 20) {
    nodes {
      ... on ProjectV2ItemFieldSingleSelectValue {
        name
        field { ... on ProjectV2FieldCommon { name } }
      }
      ... on ProjectV2ItemFieldTextValue {
        text
        field { ... on ProjectV2FieldCommon { name } }
      }
      ... on ProjectV2ItemFieldNumberValue {
        number
        field { ... on ProjectV2FieldCommon { name } }
      }
      ... on ProjectV2ItemFieldDateValue {
        date
        field { ... on ProjectV2FieldCommon { name } }
      }
      ... on ProjectV2ItemFieldIterationValue {
        title
        startDate
        field { ... on ProjectV2FieldCommon { name } }
      }
    }
  }
`;

const CONTENT_FRAGMENT = `
  content {
    ... on Issue {
      number
      title
      url
      state
      repository { nameWithOwner }
    }
    ... on PullRequest {
      number
      title
      url
      state
      repository { nameWithOwner }
    }
    ... on DraftIssue {
      title
      body
    }
  }
`;

export async function listProjects(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const owner = req(args, "owner");

  // Query both user and org — one will return null, GraphQL returns partial data
  const query = `
    query ListProjects($login: String!) {
      user(login: $login) {
        projectsV2(first: 20) {
          nodes { id number title url closed }
        }
      }
      organization(login: $login) {
        projectsV2(first: 20) {
          nodes { id number title url closed }
        }
      }
    }
  `;

  const data = await ghql<{
    user?: { projectsV2: { nodes: unknown[] } } | null;
    organization?: { projectsV2: { nodes: unknown[] } } | null;
  }>(env, query, { login: owner });

  return [
    ...(data.user?.projectsV2?.nodes ?? []),
    ...(data.organization?.projectsV2?.nodes ?? []),
  ];
}

export async function listProjectItems(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const projectId = req(args, "project_id");
  const first = typeof args.per_page === "number" ? args.per_page : 50;

  const query = `
    query ListProjectItems($projectId: ID!, $first: Int!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          title
          items(first: $first) {
            nodes {
              id
              ${FIELD_VALUES_FRAGMENT}
              ${CONTENT_FRAGMENT}
            }
          }
        }
      }
    }
  `;

  const data = await ghql<{ node: Record<string, unknown> }>(env, query, { projectId, first });
  const node = data.node;

  // Optionally filter by status
  if (typeof args.status === "string" && node?.items) {
    const items = node.items as { nodes: Array<Record<string, unknown>> };
    const targetStatus = (args.status as string).toLowerCase();
    items.nodes = items.nodes.filter(item => {
      const fields = (item.fieldValues as { nodes: Array<Record<string, unknown>> })?.nodes ?? [];
      return fields.some(f =>
        (f.field as { name?: string } | undefined)?.name === "Status" &&
        typeof f.name === "string" &&
        f.name.toLowerCase() === targetStatus
      );
    });
  }

  return node;
}

export async function getProjectItem(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const itemId = req(args, "item_id");

  const query = `
    query GetProjectItem($itemId: ID!) {
      node(id: $itemId) {
        ... on ProjectV2Item {
          id
          ${FIELD_VALUES_FRAGMENT}
          content {
            ... on Issue {
              number
              title
              body
              url
              state
              labels(first: 10) { nodes { name } }
              assignees(first: 5) { nodes { login } }
              repository { nameWithOwner }
            }
            ... on PullRequest {
              number
              title
              url
              state
              repository { nameWithOwner }
            }
            ... on DraftIssue {
              title
              body
            }
          }
        }
      }
    }
  `;

  const data = await ghql<{ node: unknown }>(env, query, { itemId });
  return data.node;
}

async function getStatusField(
  env: Env,
  projectId: string,
): Promise<{ fieldId: string; options: Array<{ id: string; name: string }> }> {
  const query = `
    query GetStatusField($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
            }
          }
        }
      }
    }
  `;

  const data = await ghql<{
    node: {
      fields: {
        nodes: Array<{ id?: string; name?: string; options?: Array<{ id: string; name: string }> }>;
      };
    };
  }>(env, query, { projectId });

  const statusField = (data.node?.fields?.nodes ?? []).find(f => f.name === "Status");
  if (!statusField?.id) throw new Error("Status field not found in project");
  return { fieldId: statusField.id, options: statusField.options ?? [] };
}

export async function updateProjectItemStatus(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const projectId = req(args, "project_id");
  const itemId = req(args, "item_id");
  const status = req(args, "status");

  const { fieldId, options } = await getStatusField(env, projectId);

  const option = options.find(o => o.name.toLowerCase() === status.toLowerCase());
  if (!option) {
    const available = options.map(o => o.name).join(", ");
    throw new Error(`Status "${status}" not found. Available: ${available}`);
  }

  const mutation = `
    mutation UpdateItemStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item { id }
      }
    }
  `;

  await ghql(env, mutation, { projectId, itemId, fieldId, optionId: option.id });
  return { success: true, itemId, status: option.name };
}

export async function addIssueToProject(env: Env, args: Record<string, unknown>): Promise<unknown> {
  const projectId = req(args, "project_id");
  const issueUrl = req(args, "issue_url");

  // Accept either a GitHub issue URL (https://github.com/owner/repo/issues/123) or a node ID
  let contentId: string;
  const match = issueUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/);
  if (match) {
    const [, owner, repo, number] = match;
    const issue = await gh<{ node_id: string }>(env, `/repos/${owner}/${repo}/issues/${number}`);
    contentId = issue.node_id;
  } else {
    contentId = issueUrl;
  }

  const mutation = `
    mutation AddIssueToProject($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }
  `;

  const result = await ghql<{ addProjectV2ItemById: { item: { id: string } } }>(env, mutation, {
    projectId,
    contentId,
  });

  const itemId = result.addProjectV2ItemById?.item?.id;
  if (!itemId) throw new Error("Failed to add issue to project");

  if (typeof args.status === "string") {
    await updateProjectItemStatus(env, { project_id: projectId, item_id: itemId, status: args.status });
  }

  return { success: true, itemId };
}
