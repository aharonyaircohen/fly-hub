import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { consumeStoredAgencyApproval } from "@kody-ade/agency/agency-approvals";
import {
  createPipelineApprovalChallenge,
  pipelineRunAction,
} from "@kody-ade/agency/pipeline-run-approval";
import { clearGitHubContext, setGitHubContext } from "@dashboard/lib/github-client";
import {
  isPipelineDefinitionId,
  validatePipelineDefinition,
} from "@dashboard/lib/pipeline-definitions";
import { validateWorkflowInput } from "@dashboard/lib/workflow-definitions";
import { createCompanyPipelineLoader } from "@dashboard/features/pipelines/server/company-pipeline-loader";
import { pipelineRequiresApproval } from "@dashboard/features/pipelines/server/pipeline-execution-authorization";
import { startPipelineExecution } from "@dashboard/features/pipelines/server/pipeline-orchestrator";
import { getWorkflowApprovalSigningKey } from "@dashboard/features/workflows/server/workflow-approval-signing-key";

const MAX_INPUT_BYTES = 64_000;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth) return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  const { id } = await params;
  if (!isPipelineDefinitionId(id)) return NextResponse.json({ error: "invalid_pipeline_id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const pipelineInput = record(body?.input) ? body.input : {};
  if (JSON.stringify(pipelineInput).length > MAX_INPUT_BYTES) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  setGitHubContext(auth.owner, auth.repo, auth.token, auth.storeRepoUrl, auth.storeRef);
  try {
    const octokit = await getUserOctokit(req);
    if (!octokit) return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) return actorResult;
    const actor = `github:${actorResult.identity.githubId}`;
    const loaded = await createCompanyPipelineLoader({
      octokit,
      owner: auth.owner,
      repo: auth.repo,
    })(id);
    if (!loaded) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const issues = [
      ...validatePipelineDefinition(loaded.pipeline),
      ...validateWorkflowInput(pipelineInput, loaded.pipeline.inputSchema),
    ];
    if (issues.length) return NextResponse.json({ error: "invalid_pipeline", issues }, { status: 409 });
    const needsApproval = await pipelineRequiresApproval(id, loaded.pipeline);
    const runId = typeof body?.runId === "string" && /^run-[A-Za-z0-9_-]{1,123}$/.test(body.runId)
      ? body.runId
      : `run-${randomUUID()}`;
    if (needsApproval) {
      if (typeof body?.approvalId !== "string") {
        const challenge = createPipelineApprovalChallenge({
          owner: auth.owner,
          repo: auth.repo,
          actor,
          pipelineId: id,
          input: pipelineInput,
          signingKey: getWorkflowApprovalSigningKey(),
        });
        return NextResponse.json({
          error: "approval_required",
          approvalToken: challenge.token,
          approvalExpiresAt: challenge.expiresAt,
        }, { status: 409 });
      }
      const consumed = await consumeStoredAgencyApproval({
        owner: auth.owner,
        repo: auth.repo,
        approvalId: body.approvalId,
        scopeKind: "pipeline",
        scopeId: id,
        action: pipelineRunAction(pipelineInput),
        approvedBy: actor,
        dispatchKey: runId,
        consumedAt: new Date().toISOString(),
      });
      if (!consumed) return NextResponse.json({ error: "approval_required" }, { status: 409 });
    }
    const started = await startPipelineExecution({
      octokit,
      owner: auth.owner,
      repo: auth.repo,
      pipelineId: id,
      pipelineRunId: runId,
      pipeline: loaded.pipeline,
      facts: pipelineInput,
    });
    return NextResponse.json({ ok: true, pipeline: id, runId, acceptedAt: started.acceptedAt }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: "dispatch_failed", message: error instanceof Error ? error.message : "Failed to run Pipeline" }, { status: 500 });
  } finally {
    clearGitHubContext();
  }
}
