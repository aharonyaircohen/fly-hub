/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-workflow-run
 * @ai-summary Authenticated HTTP adapter for starting one Workflow through the
 * provider-neutral Kody Engine execution boundary.
 */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

import {
  getRequestAuth,
  getUserOctokit,
  verifyRepoWriteAccess,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { consumeStoredAgencyApproval } from "@kody-ade/agency/agency-approvals";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import {
  createWorkflowApprovalChallenge,
  workflowRunAction,
} from "@kody-ade/agency/workflow-run-approval";
import { recordAudit } from "@dashboard/lib/activity/audit";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import {
  isWorkflowDefinitionId,
  validateWorkflowInput,
  validateWorkflowDefinition,
} from "@dashboard/lib/workflow-definitions";
import { createCompanyWorkflowLoader } from "@dashboard/features/workflows/server/company-workflow-loader";
import { createGitHubActionsEngineGateway } from "@dashboard/features/workflows/server/github-actions-engine-gateway";
import { startWorkflow } from "@dashboard/features/workflows/server/start-workflow";
import { workflowRequiresApproval } from "@dashboard/features/workflows/server/workflow-execution-authorization";
import { getWorkflowApprovalSigningKey } from "@dashboard/features/workflows/server/workflow-approval-signing-key";
import { unresolvedWorkflowCapabilityIssues } from "@dashboard/lib/capabilities/resolve-workflow";
import { ENGINE_BUILT_IN_CAPABILITIES } from "@dashboard/lib/store-solutions";

const RUN_ID = /^run-[a-zA-Z0-9_-]{1,123}$/;
const APPROVAL_ID = /^approval-[a-zA-Z0-9_-]{1,123}$/;
const MAX_INPUT_BYTES = 64_000;

interface PendingStepApproval {
  runId: string;
  stepId: string;
  contextHash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runOptions(req: NextRequest): Promise<
  | {
      ok: true;
      requestId?: string;
      resume?: boolean;
      approvalId?: string;
      input?: Record<string, unknown>;
    }
  | { ok: false }
> {
  try {
    const body = await req.json();
    if (
      body?.input !== undefined &&
      (!isRecord(body.input) ||
        JSON.stringify(body.input).length > MAX_INPUT_BYTES)
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      ...(body?.mode === "resume" &&
      typeof body.runId === "string" &&
      RUN_ID.test(body.runId)
        ? { requestId: body.runId }
        : {}),
      ...(body?.mode === "resume" &&
      typeof body.runId === "string" &&
      RUN_ID.test(body.runId)
        ? { resume: true }
        : {}),
      ...(typeof body?.approvalId === "string" &&
      APPROVAL_ID.test(body.approvalId)
        ? { approvalId: body.approvalId }
        : {}),
      ...(body?.input !== undefined ? { input: body.input } : {}),
    };
  } catch {
    return { ok: true };
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await verifyRepoWriteAccess(req);
  if (authError instanceof NextResponse) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const { id } = await params;
  if (!isWorkflowDefinitionId(id)) {
    return NextResponse.json({ error: "invalid_workflow_id" }, { status: 400 });
  }

  setGitHubContext(
    auth.owner,
    auth.repo,
    auth.token,
    auth.storeRepoUrl,
    auth.storeRef,
  );
  try {
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message: "A signed-in GitHub token is required to run a workflow.",
        },
        { status: 401 },
      );
    }
    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) return actorResult;
    const actor = `github:${actorResult.identity.githubId}`;
    const options = await runOptions(req);
    if (!options.ok) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }
    let pendingStepApproval: PendingStepApproval | null = null;
    if (options.resume && options.requestId) {
      const run = (await createBackendClient().query(
        backendApi.workflowRuns.get,
        {
          tenantId: `${auth.owner}/${auth.repo}`,
          workflowId: id,
          runId: options.requestId,
        },
      )) as {
        state?: {
          status?: string;
          approval?: {
            stepId?: string;
            contextHash?: string;
            status?: string;
          };
        };
      } | null;
      const approval = run?.state?.approval;
      if (
        run?.state?.status === "waiting-approval" &&
        approval?.status === "pending" &&
        typeof approval.stepId === "string" &&
        typeof approval.contextHash === "string"
      ) {
        pendingStepApproval = {
          runId: options.requestId,
          stepId: approval.stepId,
          contextHash: approval.contextHash,
        };
      }
    }
    const approvalInput: Record<string, unknown> = pendingStepApproval
      ? { ...pendingStepApproval }
      : (options.input ?? {});
    const result = await startWorkflow(
      {
        workflowId: id,
        source: "dashboard",
        actor,
        requestId: options.requestId,
        resume: options.resume,
        approvalId: options.approvalId,
        input: options.input,
      },
      {
        createRequestId: () => `run-${randomUUID()}`,
        now: () => new Date().toISOString(),
        loadWorkflow: createCompanyWorkflowLoader({
          octokit,
          owner: auth.owner,
          repo: auth.repo,
          syncStoreDefinitions: true,
        }),
        validateDefinition: validateWorkflowDefinition,
        validateResolvedCapabilities: async (workflow) => {
          const { config } = await getEngineConfig(
            octokit,
            auth.owner,
            auth.repo,
          );
          return unresolvedWorkflowCapabilityIssues(workflow, {
            octokit,
            activeStoreSlugs: new Set(config.company?.activeCapabilities ?? []),
            builtInSlugs: ENGINE_BUILT_IN_CAPABILITIES,
          });
        },
        validateInput: (schema, input) => validateWorkflowInput(input, schema),
        requiresApproval: async (workflowId, workflow) =>
          pendingStepApproval !== null ||
          (await workflowRequiresApproval(workflowId, workflow)),
        actionFor: () => workflowRunAction(approvalInput),
        consumeApproval: async (approval) => {
          const consumed = await consumeStoredAgencyApproval({
            owner: auth.owner,
            repo: auth.repo,
            approvalId: approval.approvalId,
            scopeKind: "workflow",
            scopeId: approval.workflowId,
            action: approval.action,
            approvedBy: approval.actor,
            dispatchKey: approval.dispatchKey,
            consumedAt: approval.consumedAt,
          });
          if (consumed && pendingStepApproval) {
            await createBackendClient().mutation(
              backendApi.workflowRuns.approveStep,
              {
                tenantId: `${auth.owner}/${auth.repo}`,
                workflowId: id,
                runId: pendingStepApproval.runId,
                stepId: pendingStepApproval.stepId,
                contextHash: pendingStepApproval.contextHash,
                approvedAt: new Date().toISOString(),
                approvedBy: actor,
              },
            );
          }
          return consumed;
        },
        dispatch: createGitHubActionsEngineGateway({
          octokit,
          owner: auth.owner,
          repo: auth.repo,
          dashboardUrl: req.nextUrl.origin,
          storeRepoUrl: auth.storeRepoUrl,
          storeRef: auth.storeRef,
        }),
      },
    );

    if (result.kind === "not-found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (result.kind === "invalid") {
      return NextResponse.json(
        {
          error: "invalid_workflow",
          message: "Workflow is invalid and was not dispatched.",
          issues: result.issues,
        },
        { status: 409 },
      );
    }
    if (result.kind === "approval-required") {
      const challenge = createWorkflowApprovalChallenge({
        owner: auth.owner,
        repo: auth.repo,
        actor,
        workflowId: id,
        input: approvalInput,
        signingKey: getWorkflowApprovalSigningKey(),
      });
      return NextResponse.json(
        {
          error: "approval_required",
          message: "This workflow requires explicit approval before it runs.",
          approvalToken: challenge.token,
          approvalExpiresAt: challenge.expiresAt,
          ...(pendingStepApproval
            ? { approvalContext: pendingStepApproval }
            : {}),
        },
        { status: 409 },
      );
    }

    recordAudit(req, {
      action: "workflow.run",
      resource: id,
      detail: `manual Engine dispatch for workflow ${id}`,
    });
    return NextResponse.json(
      {
        ok: true,
        execution: "kody-engine",
        workflow: id,
        runId: result.requestId,
        acceptedAt: result.acceptedAt,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("[company-workflows/run] dispatch failed", error);
    return NextResponse.json(
      {
        error: "dispatch_failed",
        message:
          error instanceof Error
            ? error.message
            : "Failed to dispatch workflow",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
