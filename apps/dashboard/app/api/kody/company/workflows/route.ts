/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-workflows-api
 * @ai-summary Lists and creates validated workflow definitions in the
 *   configured Kody backend.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { getEngineConfig, type KodyConfig } from "@kody-ade/base/engine/config";
import { reconcileProjectedStoreWorkflows } from "@dashboard/lib/backend/repo-projection";
import {
  buildWorkflowDefinition,
  slugifyWorkflowDefinitionId,
  validateWorkflowDefinition,
  workflowStepDefinitionSchema,
  workflowDefinitionPath,
} from "@dashboard/lib/workflow-definitions";
import {
  listCompanyStoreWorkflowDefinitionFiles,
  listWorkflowDefinitionFiles,
  readWorkflowDefinitionFile,
  writeWorkflowDefinitionFile,
} from "@dashboard/lib/workflow-definition-files";
import {
  unresolvedWorkflowCapabilityIssues,
  workflowValidationMessage,
} from "@dashboard/lib/capabilities/resolve-workflow";
import { ENGINE_BUILT_IN_CAPABILITIES } from "@dashboard/lib/store-solutions";
import { workflowAutomationEligibility } from "@dashboard/features/workflows/server/workflow-execution-authorization";
import { effectiveActiveWorkflowIds } from "@dashboard/features/workflows/built-in-workflows";

const workflowPayloadSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(160),
  agent: z.string().trim().min(1).max(80).default("kody"),
  capabilities: z.array(z.string().trim().min(1).max(80)).min(1),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  startAt: z.string().trim().min(1).max(80).optional(),
  steps: z.array(workflowStepDefinitionSchema).min(1).optional(),
  report: z.record(z.string(), z.unknown()).optional(),
  runWithoutApproval: z.boolean().optional(),
  actorLogin: z.string().trim().optional(),
});

function mapGithubError(error: any, fallback: string, status = 500) {
  if (error?.status === 401) {
    return NextResponse.json(
      { error: "github_token_expired" },
      { status: 401 },
    );
  }
  if (error?.status === 403 || error?.message?.includes("rate limit")) {
    return NextResponse.json(
      { error: "rate_limited", message: "GitHub API rate limit exceeded" },
      { status: 429 },
    );
  }
  return NextResponse.json(
    { error: fallback, message: error?.message ?? fallback },
    { status },
  );
}

function activeCapabilitySlugs(config: KodyConfig): string[] {
  return (config.company?.activeCapabilities ?? []).filter(
    (slug): slug is string =>
      typeof slug === "string" && slug.trim().length > 0,
  );
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(
    headerAuth.owner,
    headerAuth.repo,
    headerAuth.token,
    headerAuth.storeRepoUrl,
    headerAuth.storeRef,
  );
  try {
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const localWorkflows = await listWorkflowDefinitionFiles(
      headerAuth.owner,
      headerAuth.repo,
    );
    const { config } = await getEngineConfig(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const activeWorkflowIds = effectiveActiveWorkflowIds(
      config.company?.activeWorkflows,
    );
    const storeWorkflowIds = activeWorkflowIds;
    const localIds = new Set(localWorkflows.map((workflow) => workflow.id));
    const storeWorkflows =
      storeWorkflowIds.size > 0
        ? (await listCompanyStoreWorkflowDefinitionFiles(octokit)).filter(
            (workflow) =>
              storeWorkflowIds.has(workflow.id) && !localIds.has(workflow.id),
          )
        : [];
    const workflows = [...localWorkflows, ...storeWorkflows].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    await reconcileProjectedStoreWorkflows(
      headerAuth.owner,
      headerAuth.repo,
      storeWorkflows,
    ).catch(() => undefined);
    const automationById = await workflowAutomationEligibility(workflows);
    const workflowsWithAutomation = workflows.map((workflow) => ({
      ...workflow,
      automation: automationById.get(workflow.id) ?? {
        eligible: false as const,
        reason: "approval-required" as const,
      },
    }));
    return NextResponse.json(
      { workflows: workflowsWithAutomation },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return mapGithubError(err, "failed_to_list_workflows");
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(
    headerAuth.owner,
    headerAuth.repo,
    headerAuth.token,
    headerAuth.storeRepoUrl,
    headerAuth.storeRef,
  );
  try {
    const payload = await req.json().catch(() => null);
    const parsed = workflowPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, parsed.data.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const id =
      slugifyWorkflowDefinitionId(parsed.data.id ?? "") ||
      slugifyWorkflowDefinitionId(parsed.data.name);
    if (!id) {
      return NextResponse.json(
        { error: "invalid_workflow_id" },
        { status: 400 },
      );
    }
    workflowDefinitionPath(id);

    const existing = await readWorkflowDefinitionFile(
      id,
      headerAuth.owner,
      headerAuth.repo,
    );
    if (existing) {
      return NextResponse.json(
        {
          error: "workflow_exists",
          message: `Workflow "${id}" already exists.`,
        },
        { status: 409 },
      );
    }

    const workflow = buildWorkflowDefinition(parsed.data);
    if (workflow.capabilities.length === 0) {
      return NextResponse.json(
        {
          error: "invalid_body",
          message: "Workflow needs at least one capability.",
        },
        { status: 400 },
      );
    }
    const { config } = await getEngineConfig(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const validationIssues = [
      ...validateWorkflowDefinition(workflow),
      ...(await unresolvedWorkflowCapabilityIssues(workflow, {
        octokit,
        tenantId: `${headerAuth.owner}/${headerAuth.repo}`,
        activeStoreSlugs: new Set(activeCapabilitySlugs(config)),
        builtInSlugs: ENGINE_BUILT_IN_CAPABILITIES,
      })),
    ];
    if (validationIssues.length > 0) {
      return NextResponse.json(
        {
          error: "invalid_workflow",
          message: workflowValidationMessage(validationIssues),
          issues: validationIssues,
        },
        { status: 400 },
      );
    }
    const path = workflowDefinitionPath(id);
    await writeWorkflowDefinitionFile({
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      id,
      workflow,
    });

    return NextResponse.json({
      workflow: {
        id,
        path,
        workflow,
        updatedAt: workflow.updatedAt,
        source: "local",
        readOnly: false,
        runnable: true,
      },
    });
  } catch (err: any) {
    return mapGithubError(err, "failed_to_create_workflow");
  } finally {
    clearGitHubContext();
  }
}
