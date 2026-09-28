/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-workflow-detail-api
 * @ai-summary Reads, updates, and deletes workflow definition files in the
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
import {
  getEngineConfig,
  writeConfigPatch,
  type ConfigPatch,
} from "@kody-ade/base/engine/config";
import {
  isWorkflowDefinitionId,
  mergeWorkflowDefinition,
  validateWorkflowDefinition,
  workflowStepDefinitionSchema,
  workflowDefinitionPath,
} from "@dashboard/lib/workflow-definitions";
import {
  deleteWorkflowDefinitionFile,
  readCompanyStoreWorkflowDefinitionFile,
  readWorkflowDefinitionFile,
  writeWorkflowDefinitionFile,
} from "@dashboard/lib/workflow-definition-files";
import {
  unresolvedWorkflowCapabilityIssues,
  workflowValidationMessage,
} from "@dashboard/lib/capabilities/resolve-workflow";
import { ENGINE_BUILT_IN_CAPABILITIES } from "@dashboard/lib/store-solutions";
import {
  effectiveActiveWorkflowIds,
  isBuiltInWorkflow,
} from "@dashboard/features/workflows/built-in-workflows";

const workflowPatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  agent: z.string().trim().min(1).max(80).optional(),
  capabilities: z.array(z.string().trim().min(1).max(80)).min(1).optional(),
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

async function getContext(req: NextRequest) {
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
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_user_token" }, { status: 401 });
  }

  return { headerAuth, octokit };
}

function stringSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? []).filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    ),
  );
}

async function activeStoreReferenceSets(
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>,
  owner: string,
  repo: string,
): Promise<{ activeCapabilities: Set<string>; activeWorkflows: Set<string> }> {
  const { config } = await getEngineConfig(octokit, owner, repo, {
    force: true,
  });
  return {
    activeCapabilities: stringSet(config.company?.activeCapabilities),
    activeWorkflows: effectiveActiveWorkflowIds(
      config.company?.activeWorkflows,
    ),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getContext(req);
    if (context instanceof NextResponse) return context;

    const { id } = await params;
    if (!isWorkflowDefinitionId(id)) {
      return NextResponse.json(
        { error: "invalid_workflow_id" },
        { status: 400 },
      );
    }

    const existing = await readWorkflowDefinitionFile(
      id,
      context.headerAuth.owner,
      context.headerAuth.repo,
    );
    if (!existing) {
      const includeStore =
        req.nextUrl.searchParams.get("includeStore") === "true";
      if (includeStore) {
        const storeWorkflow = await readCompanyStoreWorkflowDefinitionFile(
          id,
          context.octokit,
        );
        if (storeWorkflow) {
          return NextResponse.json({ workflow: storeWorkflow });
        }
      }
      const active = await activeStoreReferenceSets(
        context.octokit,
        context.headerAuth.owner,
        context.headerAuth.repo,
      );
      if (active.activeWorkflows.has(id)) {
        const storeWorkflow = await readCompanyStoreWorkflowDefinitionFile(
          id,
          context.octokit,
        );
        if (storeWorkflow) {
          return NextResponse.json({ workflow: storeWorkflow });
        }
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({
      workflow: {
        id,
        path: existing.path,
        workflow: existing.workflow,
        updatedAt: existing.workflow.updatedAt,
        source: "local",
        readOnly: false,
        runnable: true,
      },
    });
  } catch (err: any) {
    return mapGithubError(err, "failed_to_read_workflow");
  } finally {
    clearGitHubContext();
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getContext(req);
    if (context instanceof NextResponse) return context;

    const { id } = await params;
    if (!isWorkflowDefinitionId(id)) {
      return NextResponse.json(
        { error: "invalid_workflow_id" },
        { status: 400 },
      );
    }

    const payload = await req.json().catch(() => null);
    const parsed = workflowPatchSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, parsed.data.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    workflowDefinitionPath(id);
    const existing = await readWorkflowDefinitionFile(
      id,
      context.headerAuth.owner,
      context.headerAuth.repo,
    );
    if (!existing) {
      const storeWorkflow = await readCompanyStoreWorkflowDefinitionFile(
        id,
        context.octokit,
      );
      if (storeWorkflow) {
        return NextResponse.json(
          {
            error: "store_workflow_protected",
            message: "Store workflows cannot be edited from this repo.",
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const workflow = mergeWorkflowDefinition(existing.workflow, parsed.data);
    if (workflow.capabilities.length === 0) {
      return NextResponse.json(
        {
          error: "invalid_body",
          message: "Workflow needs at least one capability.",
        },
        { status: 400 },
      );
    }
    const { activeCapabilities } = await activeStoreReferenceSets(
      context.octokit,
      context.headerAuth.owner,
      context.headerAuth.repo,
    );
    const validationIssues = [
      ...validateWorkflowDefinition(workflow),
      ...(await unresolvedWorkflowCapabilityIssues(workflow, {
        octokit: context.octokit,
        tenantId: `${context.headerAuth.owner}/${context.headerAuth.repo}`,
        activeStoreSlugs: activeCapabilities,
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

    await writeWorkflowDefinitionFile({
      owner: context.headerAuth.owner,
      repo: context.headerAuth.repo,
      id,
      workflow,
    });

    return NextResponse.json({
      workflow: {
        id,
        path: existing.path,
        workflow,
        updatedAt: workflow.updatedAt,
        source: "local",
        readOnly: false,
        runnable: true,
      },
    });
  } catch (err: any) {
    return mapGithubError(err, "failed_to_update_workflow");
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getContext(req);
    if (context instanceof NextResponse) return context;

    const { id } = await params;
    if (!isWorkflowDefinitionId(id)) {
      return NextResponse.json(
        { error: "invalid_workflow_id" },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) return actorResult;

    const existing = await readWorkflowDefinitionFile(
      id,
      context.headerAuth.owner,
      context.headerAuth.repo,
    );
    if (!existing) {
      if (isBuiltInWorkflow(id)) {
        return NextResponse.json(
          {
            error: "built_in_workflow_required",
            message: "Built-in workflows cannot be removed.",
          },
          { status: 409 },
        );
      }
      const active = await activeStoreReferenceSets(
        context.octokit,
        context.headerAuth.owner,
        context.headerAuth.repo,
      );
      const patch: ConfigPatch = {};
      if (active.activeWorkflows.has(id)) {
        const nextActiveWorkflows = [...active.activeWorkflows].filter(
          (slug) => slug !== id,
        );
        patch.activeWorkflows =
          nextActiveWorkflows.length > 0 ? nextActiveWorkflows : null;
      }
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      await writeConfigPatch(
        context.octokit,
        context.headerAuth.owner,
        context.headerAuth.repo,
        patch,
        `chore(workflows): remove store workflow ${id}`,
      );
      return NextResponse.json({
        success: true,
        removedStoreReference: true,
      });
    }

    await deleteWorkflowDefinitionFile({
      owner: context.headerAuth.owner,
      repo: context.headerAuth.repo,
      id,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return mapGithubError(err, "failed_to_delete_workflow");
  } finally {
    clearGitHubContext();
  }
}
