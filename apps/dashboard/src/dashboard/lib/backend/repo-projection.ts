import type { KodyConfig } from "@kody-ade/base/engine/config";
import { defaultConfig } from "@kody-ade/base/engine/config";
import type { Octokit } from "@octokit/rest";
import { listCatalogEntries, saveCatalogEntry } from "./catalog";
import { backendApi, getConvexClient, tenantIdFor } from "./convex-backend";
import type { WorkflowDefinitionRecord } from "../workflow-definitions";
import type { CapabilitySummary } from "@kody-ade/agency/capabilities/files";
import type { PipelineDefinitionRecord } from "../pipeline-definitions";

export async function getProjectedEngineConfig(
  _octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ config: KodyConfig; sha: string | null }> {
  const projected = await listCatalogEntries<{
    config: KodyConfig;
    sha: string | null;
  }>(owner, repo, "config");
  const current = projected.find((entry) => entry.slug === "kody.config.json");
  return current?.doc?.config
    ? { config: current.doc.config, sha: current.doc.sha ?? null }
    : { config: defaultConfig, sha: null };
}

export async function saveProjectedEngineConfig(
  owner: string,
  repo: string,
  config: KodyConfig,
  sha: string | null,
): Promise<void> {
  await saveCatalogEntry(
    owner,
    repo,
    "config",
    "kody.config.json",
    { config, sha },
    "dashboard-write",
  );
}

export async function listProjectedWorkflows(
  owner: string,
  repo: string,
): Promise<WorkflowDefinitionRecord[]> {
  const docs = (await getConvexClient().query(backendApi.workflows.list, {
    tenantId: tenantIdFor(owner, repo),
  })) as Array<{
    workflowId: string;
    definition: WorkflowDefinitionRecord["workflow"];
    source: "local" | "store";
    updatedAt: string;
  }>;
  return docs.map((doc) => ({
    id: doc.workflowId,
    path: `convex:workflows/${doc.workflowId}`,
    workflow: doc.definition,
    source: doc.source,
    updatedAt: doc.updatedAt,
    readOnly: doc.source === "store",
    runnable: true,
  }));
}

export async function saveProjectedWorkflow(
  owner: string,
  repo: string,
  workflow: WorkflowDefinitionRecord,
): Promise<void> {
  await getConvexClient().mutation(backendApi.workflows.save, {
    tenantId: tenantIdFor(owner, repo),
    workflowId: workflow.id,
    definition: workflow.workflow,
    source: workflow.source === "store" ? "store" : "local",
    updatedAt: workflow.updatedAt ?? new Date().toISOString(),
  });
}

/**
 * Keep the read-only Store view in sync without touching tenant-owned
 * workflows. Store remains authoritative; this projection is replaceable.
 */
export async function reconcileProjectedStoreWorkflows(
  owner: string,
  repo: string,
  workflows: readonly WorkflowDefinitionRecord[],
): Promise<void> {
  const projected = await listProjectedWorkflows(owner, repo);
  const desiredIds = new Set(workflows.map((workflow) => workflow.id));
  const staleStoreWorkflows = projected.filter(
    (workflow) => workflow.source === "store" && !desiredIds.has(workflow.id),
  );

  await Promise.all([
    ...workflows.map((workflow) =>
      saveProjectedWorkflow(owner, repo, {
        ...workflow,
        source: "store",
        readOnly: true,
      }),
    ),
    ...staleStoreWorkflows.map((workflow) =>
      getConvexClient().mutation(backendApi.workflows.remove, {
        tenantId: tenantIdFor(owner, repo),
        workflowId: workflow.id,
      }),
    ),
  ]);
}

export async function listProjectedPipelines(
  owner: string,
  repo: string,
): Promise<PipelineDefinitionRecord[]> {
  const docs = (await getConvexClient().query(backendApi.pipelines.list, {
    tenantId: tenantIdFor(owner, repo),
  })) as Array<{
    pipelineId: string;
    definition: PipelineDefinitionRecord["pipeline"];
    source: "local" | "store";
    updatedAt: string;
  }>;
  return docs.map((doc) => ({
    id: doc.pipelineId,
    path: `convex:pipelines/${doc.pipelineId}`,
    pipeline: doc.definition,
    source: doc.source,
    updatedAt: doc.updatedAt,
    readOnly: doc.source === "store",
    runnable: true,
  }));
}

export async function reconcileProjectedStorePipelines(
  owner: string,
  repo: string,
  pipelines: readonly PipelineDefinitionRecord[],
): Promise<void> {
  const projected = await listProjectedPipelines(owner, repo);
  const desired = new Set(pipelines.map((pipeline) => pipeline.id));
  await Promise.all([
    ...pipelines.map((pipeline) =>
      getConvexClient().mutation(backendApi.pipelines.save, {
        tenantId: tenantIdFor(owner, repo),
        pipelineId: pipeline.id,
        definition: pipeline.pipeline,
        source: "store" as const,
        updatedAt:
          pipeline.updatedAt ?? pipeline.pipeline.updatedAt ?? new Date().toISOString(),
      }),
    ),
    ...projected
      .filter(
        (pipeline) =>
          pipeline.source === "store" && !desired.has(pipeline.id),
      )
      .map((pipeline) =>
        getConvexClient().mutation(backendApi.pipelines.remove, {
          tenantId: tenantIdFor(owner, repo),
          pipelineId: pipeline.id,
        }),
      ),
  ]);
}

export async function listProjectedCapabilities(
  owner: string,
  repo: string,
  activeStoreSlugs: Set<string>,
): Promise<CapabilitySummary[]> {
  const entries = await listCatalogEntries<CapabilitySummary>(
    owner,
    repo,
    "capability",
  );
  return entries
    .map((entry) => entry.doc)
    .filter(
      (capability) =>
        capability.source !== "store" || activeStoreSlugs.has(capability.slug),
    );
}

export async function saveProjectedCapability(
  owner: string,
  repo: string,
  capability: CapabilitySummary,
): Promise<void> {
  await saveCatalogEntry(
    owner,
    repo,
    "capability",
    capability.slug,
    capability,
    capability.source === "store" ? "company-store" : "engine-definition",
    capability.updatedAt ?? undefined,
  );
}

export async function getProjectedCapability(
  owner: string,
  repo: string,
  slug: string,
): Promise<CapabilitySummary | null> {
  const entry = await getConvexClient().query(backendApi.catalog.get, {
    tenantId: tenantIdFor(owner, repo),
    category: "capability",
    slug,
  });
  return (entry as { doc?: CapabilitySummary } | null)?.doc ?? null;
}
