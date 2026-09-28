import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { grantStoredAgencyApproval } from "@kody-ade/agency/agency-approvals";
import { verifyWorkflowApprovalChallenge } from "@kody-ade/agency/workflow-run-approval";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import {
  isWorkflowDefinitionId,
  validateWorkflowDefinition,
  validateWorkflowInput,
} from "@dashboard/lib/workflow-definitions";
import { createCompanyWorkflowLoader } from "@dashboard/features/workflows/server/company-workflow-loader";
import { getWorkflowApprovalSigningKey } from "@dashboard/features/workflows/server/workflow-approval-signing-key";
import { approveWorkflowRun } from "@dashboard/features/workflows/server/approve-workflow-run";

const MAX_INPUT_BYTES = 64_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const { id } = await params;
  if (!isWorkflowDefinitionId(id)) {
    return NextResponse.json({ error: "invalid_workflow_id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    typeof body.approvalToken !== "string" ||
    !isRecord(body.input) ||
    JSON.stringify(body.input).length > MAX_INPUT_BYTES
  ) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const approvalToken = body.approvalToken;
  const workflowInput = body.input;

  const actorResult = await verifyActorLogin(req, undefined);
  if (actorResult instanceof NextResponse) return actorResult;
  const actor = `github:${actorResult.identity.githubId}`;
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
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }
    const result = await approveWorkflowRun(
      { workflowId: id, input: workflowInput },
      {
        verifyChallenge: () =>
          verifyWorkflowApprovalChallenge({
            owner: auth.owner,
            repo: auth.repo,
            actor,
            workflowId: id,
            input: workflowInput,
            signingKey: getWorkflowApprovalSigningKey(),
            token: approvalToken,
          }),
        loadWorkflow: createCompanyWorkflowLoader({
          octokit,
          owner: auth.owner,
          repo: auth.repo,
        }),
        validateWorkflow: (workflow, input) => [
          ...validateWorkflowDefinition(workflow),
          ...validateWorkflowInput(input, workflow.inputSchema),
        ],
        grantApproval: (approval) =>
          grantStoredAgencyApproval({
            owner: auth.owner,
            repo: auth.repo,
            approvalId: approval.approvalId,
            scopeKind: "workflow",
            scopeId: id,
            action: approval.action,
            approvedBy: actor,
            approvedAt: new Date().toISOString(),
            expiresAt: approval.expiresAt,
          }),
      },
    );
    if (result.kind === "invalid-approval") {
      return NextResponse.json({ error: "invalid_approval" }, { status: 409 });
    }
    if (result.kind === "not-found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (result.kind === "invalid") {
      return NextResponse.json(
        { error: "invalid_workflow", issues: result.issues },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { approvalId: result.approvalId },
      { status: 201 },
    );
  } catch (error) {
    const duplicate =
      error instanceof Error &&
      error.message.includes("Agency Approval already exists");
    return NextResponse.json(
      {
        error: duplicate ? "approval_already_used" : "approval_failed",
        message: duplicate
          ? "This approval was already submitted."
          : "Failed to record workflow approval.",
      },
      { status: duplicate ? 409 : 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
