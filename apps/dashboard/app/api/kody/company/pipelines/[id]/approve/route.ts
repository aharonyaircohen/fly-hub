import { NextRequest, NextResponse } from "next/server";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { grantStoredAgencyApproval } from "@kody-ade/agency/agency-approvals";
import {
  verifyPipelineApprovalChallenge,
} from "@kody-ade/agency/pipeline-run-approval";
import { clearGitHubContext, setGitHubContext } from "@dashboard/lib/github-client";
import { isPipelineDefinitionId, validatePipelineDefinition } from "@dashboard/lib/pipeline-definitions";
import { validateWorkflowInput } from "@dashboard/lib/workflow-definitions";
import { createCompanyPipelineLoader } from "@dashboard/features/pipelines/server/company-pipeline-loader";
import { getWorkflowApprovalSigningKey } from "@dashboard/features/workflows/server/workflow-approval-signing-key";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth) return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  const { id } = await params;
  if (!isPipelineDefinitionId(id)) return NextResponse.json({ error: "invalid_pipeline_id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (!record(body) || typeof body.approvalToken !== "string" || !record(body.input)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const actorResult = await verifyActorLogin(req, undefined);
  if (actorResult instanceof NextResponse) return actorResult;
  const actor = `github:${actorResult.identity.githubId}`;
  setGitHubContext(auth.owner, auth.repo, auth.token, auth.storeRepoUrl, auth.storeRef);
  try {
    const octokit = await getUserOctokit(req);
    if (!octokit) return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    const loaded = await createCompanyPipelineLoader({ octokit, owner: auth.owner, repo: auth.repo })(id);
    if (!loaded) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const issues = [...validatePipelineDefinition(loaded.pipeline), ...validateWorkflowInput(body.input, loaded.pipeline.inputSchema)];
    if (issues.length) return NextResponse.json({ error: "invalid_pipeline", issues }, { status: 409 });
    const challenge = verifyPipelineApprovalChallenge({
      owner: auth.owner,
      repo: auth.repo,
      actor,
      pipelineId: id,
      input: body.input,
      signingKey: getWorkflowApprovalSigningKey(),
      token: body.approvalToken,
    });
    if (!challenge) return NextResponse.json({ error: "invalid_approval" }, { status: 409 });
    await grantStoredAgencyApproval({
      owner: auth.owner,
      repo: auth.repo,
      approvalId: challenge.approvalId,
      scopeKind: "pipeline",
      scopeId: id,
      action: challenge.action,
      approvedBy: actor,
      approvedAt: new Date().toISOString(),
      expiresAt: challenge.expiresAt,
    });
    return NextResponse.json({ approvalId: challenge.approvalId }, { status: 201 });
  } finally {
    clearGitHubContext();
  }
}
