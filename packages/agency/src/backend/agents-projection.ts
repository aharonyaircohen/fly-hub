import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

function tenantIdFor(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

export interface ProjectedAgent {
  slug: string;
  title: string;
  body: string;
  updatedAt?: string;
  source?: "local" | "store";
  readOnly?: boolean;
  capabilities?: string[];
}

export async function listProjectedAgents(
  owner: string,
  repo: string,
): Promise<ProjectedAgent[]> {
  const client = createBackendClient();
  const rows = (await client.query(backendApi.agents.list, {
    tenantId: tenantIdFor(owner, repo),
  })) as Array<{
    slug: string;
    frontmatter: { title?: string; capabilities?: string[] };
    body: string;
    updatedAt: string;
  }>;
  return rows.map((row) => ({
    slug: row.slug,
    title: row.frontmatter?.title ?? row.slug,
    body: row.body,
    updatedAt: row.updatedAt,
    capabilities: row.frontmatter?.capabilities,
    source: "local",
    readOnly: false,
  }));
}

export async function getProjectedAgent(
  owner: string,
  repo: string,
  slug: string,
): Promise<ProjectedAgent | null> {
  const rows = (await createBackendClient().query(backendApi.agents.list, {
    tenantId: tenantIdFor(owner, repo),
  })) as Array<{
    slug: string;
    frontmatter: { title?: string; capabilities?: string[] };
    body: string;
    updatedAt: string;
  }>;
  const row = rows.find((candidate) => candidate.slug === slug);
  return row
    ? {
        slug: row.slug,
        title: row.frontmatter?.title ?? row.slug,
        body: row.body,
        updatedAt: row.updatedAt,
        capabilities: row.frontmatter?.capabilities,
        source: "local",
        readOnly: false,
      }
    : null;
}

export async function saveProjectedAgent(
  owner: string,
  repo: string,
  agent: ProjectedAgent,
): Promise<void> {
  await createBackendClient().mutation(backendApi.agents.save, {
    tenantId: tenantIdFor(owner, repo),
    slug: agent.slug,
    frontmatter: {
      title: agent.title,
      ...(agent.capabilities ? { capabilities: agent.capabilities } : {}),
    },
    body: agent.body,
    updatedAt: agent.updatedAt ?? new Date().toISOString(),
  });
}

export async function removeProjectedAgent(
  owner: string,
  repo: string,
  slug: string,
): Promise<void> {
  await createBackendClient().mutation(backendApi.agents.remove, {
    tenantId: tenantIdFor(owner, repo),
    slug,
  });
}
