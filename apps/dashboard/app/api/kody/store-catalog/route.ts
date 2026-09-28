/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern store-catalog-api
 * @ai-summary Read-only catalog for the simple Agency assets.
 */

import { NextRequest, NextResponse } from "next/server";

import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { getRequestAuth, requireKodyAuth } from "@kody-ade/base/auth";
import {
  buildCompanyStoreHtmlUrl,
  buildCompanyStoreBlobUrl,
} from "@kody-ade/base/company-store/assets";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import { BUILTIN_FEATURES } from "@dashboard/lib/features/catalog";
import { listStoreCatalogSlugs } from "@dashboard/lib/store-catalog-index";
import { runnableStoreDefinitionSlugs } from "@dashboard/lib/store-installation-status";
import {
  listStoreSolutions,
  loadStoreSolutionCatalog,
  resolveStoreSolutionTree,
  type StoreSolutionNode,
  type StoreSolutionStatus,
} from "@dashboard/lib/store-solutions";
import {
  clearGitHubContext,
  getOctokit,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { listRepositoryLoops } from "@dashboard/lib/repository-loops";
import { getTriggers } from "@kody-ade/base/triggers";
import { readStoreStrategy } from "@dashboard/lib/store-strategies";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CatalogKind =
  | "agent"
  | "pipeline"
  | "workflow"
  | "capability"
  | "loop"
  | "trigger"
  | "command"
  | "feature"
  | "blueprint";

type CatalogItem = {
  slug: string;
  title: string;
  description: string;
  kind: CatalogKind;
  htmlUrl: string | null;
  installed: boolean;
  setupHref?: string | null;
  uninstallBlockedBy: Array<{
    kind: "workflow";
    slug: string;
    title?: string;
  }>;
  blueprint?: {
    version: string;
    constraints: string[];
    verification: string[];
    repositoryTypes: string[];
    providers: string[];
  };
};

type CatalogSolution = {
  slug: string;
  title: string;
  description: string;
  kind: "solution";
  htmlUrl: string;
  installed: boolean;
  status: StoreSolutionStatus;
  tree: StoreSolutionNode[];
};

function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(
    auth.owner,
    auth.repo,
    auth.token,
    auth.storeRepoUrl,
    auth.storeRef,
  );

  try {
    const octokit = getOctokit();
    const tenantId = `${auth.owner}/${auth.repo}`;
    const backend = createBackendClient();
    const [
      localLoops,
      localTriggers,
      engine,
      agentDefinitions,
      capabilityDefinitions,
    ] = await Promise.all([
      listRepositoryLoops(octokit, auth.owner, auth.repo),
      getTriggers(octokit, auth.owner, auth.repo, { cache: false }),
      getEngineConfig(octokit, auth.owner, auth.repo, { force: true }),
      backend.query(backendApi.definitions.listCurrent, {
        tenantId,
        kind: "agent",
      }),
      backend.query(backendApi.definitions.listCurrent, {
        tenantId,
        kind: "capability",
      }),
    ]);
    const config = engine.config.company;
    const active = {
      agent: new Set(config?.activeAgents ?? []),
      capability: new Set(config?.activeCapabilities ?? []),
      command: new Set(config?.activeCommands ?? []),
      workflow: new Set(config?.activeWorkflows ?? []),
      pipeline: new Set(config?.activePipelines ?? []),
      feature: new Set(config?.activeFeatures ?? []),
      loop: new Set(localLoops.map((item) => item.id)),
      trigger: new Set(localTriggers.map((item) => item.id)),
    };
    const runnableAgents = runnableStoreDefinitionSlugs(
      active.agent,
      agentDefinitions,
    );
    const runnableCapabilities = runnableStoreDefinitionSlugs(
      active.capability,
      capabilityDefinitions,
    );
    const {
      capabilities,
      agents,
      commands,
      workflows: workflowSlugs,
      pipelines: pipelineSlugs,
      loops,
      triggers,
      solutions: solutionSlugs,
      strategies,
    } = await listStoreCatalogSlugs(octokit);
    const [solutionRecords, solutionCatalog, strategyRecords] = await Promise.all([
      listStoreSolutions(octokit, solutionSlugs),
      loadStoreSolutionCatalog(octokit, {
        agents,
        capabilities,
        workflows: workflowSlugs,
        pipelines: pipelineSlugs,
        loops,
        triggers,
      }),
      Promise.all(strategies.map((id) => readStoreStrategy(octokit, id))),
    ]);
    const activeWorkflows = [...solutionCatalog.workflows.values()].filter(
      (workflow) => active.workflow.has(workflow.id),
    );

    const workflowBlockers = (agent: string) =>
      activeWorkflows
        .filter((item) => item.agent === agent)
        .map((item) => ({
          kind: "workflow" as const,
          slug: item.id,
          title: item.name || item.id,
        }));

    const solutions: CatalogSolution[] = solutionRecords.map((solution) => {
      const resolved = resolveStoreSolutionTree(solution, solutionCatalog, {
        agents: runnableAgents,
        capabilities: runnableCapabilities,
        workflows: active.workflow,
        pipelines: active.pipeline,
        loops: active.loop,
        triggers: active.trigger,
      });
      return {
        slug: solution.id,
        title: solution.name,
        description: solution.description,
        kind: "solution",
        htmlUrl: solution.htmlUrl,
        installed: resolved.status === "installed",
        status: resolved.status,
        tree: resolved.tree,
      };
    });

    const items: CatalogItem[] = [
      ...capabilities.map((slug) => ({
        slug,
        title: titleFromSlug(slug),
        description: `Capability folder: ${slug}`,
        kind: "capability" as const,
        htmlUrl: buildCompanyStoreHtmlUrl("capabilities", slug),
        installed: runnableCapabilities.has(slug),
        uninstallBlockedBy: [],
      })),
      ...agents.map((slug) => ({
        slug,
        title: titleFromSlug(slug),
        description: `Agent: ${slug}`,
        kind: "agent" as const,
        htmlUrl: buildCompanyStoreBlobUrl(`agents/${slug}.md`),
        installed: runnableAgents.has(slug),
        uninstallBlockedBy: workflowBlockers(slug),
      })),
      ...commands.map((slug) => ({
        slug,
        title: `/${slug}`,
        description: `Command: /${slug}`,
        kind: "command" as const,
        htmlUrl: buildCompanyStoreBlobUrl(`commands/${slug}.md`),
        installed: active.command.has(slug),
        uninstallBlockedBy: [],
      })),
      ...workflowSlugs.map((slug) => ({
        slug,
        title: titleFromSlug(slug),
        description: `Workflow: ${slug}`,
        kind: "workflow" as const,
        htmlUrl: buildCompanyStoreHtmlUrl("workflows", slug),
        installed: active.workflow.has(slug),
        uninstallBlockedBy: [],
      })),
      ...pipelineSlugs.map((slug) => ({
        slug,
        title: titleFromSlug(slug),
        description: `Pipeline: ${slug}`,
        kind: "pipeline" as const,
        htmlUrl: buildCompanyStoreHtmlUrl("pipelines", slug),
        installed: active.pipeline.has(slug),
        uninstallBlockedBy: [],
      })),
      ...loops.map((slug) => ({
        slug,
        title: titleFromSlug(slug),
        description: `Loop: ${slug}`,
        kind: "loop" as const,
        htmlUrl: buildCompanyStoreHtmlUrl("loops", slug),
        installed: active.loop.has(slug),
        uninstallBlockedBy: [],
      })),
      ...triggers.map((slug) => ({
        slug,
        title: titleFromSlug(slug),
        description: `Trigger: ${slug}`,
        kind: "trigger" as const,
        htmlUrl: buildCompanyStoreHtmlUrl("triggers", slug),
        installed: active.trigger.has(slug),
        uninstallBlockedBy: [],
      })),
      ...BUILTIN_FEATURES.map((item) => ({
        slug: item.slug,
        title: item.title,
        description: item.description,
        kind: "feature" as const,
        htmlUrl: null,
        setupHref: item.setupHref ?? null,
        installed: active.feature.has(item.slug),
        uninstallBlockedBy: [],
      })),
      ...strategyRecords.flatMap((record) =>
        record
          ? [
              {
                slug: record.blueprint.id,
                title: record.blueprint.name,
                description: record.blueprint.outcome,
                kind: "blueprint" as const,
                htmlUrl: buildCompanyStoreHtmlUrl(
                  "strategies",
                  record.blueprint.id,
                ),
                installed: false,
                uninstallBlockedBy: [],
                blueprint: {
                  version: record.blueprint.version,
                  constraints: record.blueprint.constraints,
                  verification: record.blueprint.verification.criteria,
                  repositoryTypes:
                    record.blueprint.compatibility.repositoryTypes,
                  providers: record.blueprint.compatibility.providers,
                },
              },
            ]
          : [],
      ),
    ];

    return NextResponse.json(
      {
        solutions,
        items: items.sort((left, right) =>
          `${left.kind}:${left.slug}`.localeCompare(
            `${right.kind}:${right.slug}`,
          ),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "store_catalog_failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
