import { NextRequest, NextResponse } from "next/server";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { clearGitHubContext, setGitHubContext } from "@dashboard/lib/github-client";
import { isPipelineDefinitionId } from "@dashboard/lib/pipeline-definitions";
import { decidePipelineExecution } from "@dashboard/features/pipelines/server/pipeline-orchestrator";

export async function POST(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; runId: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const { id, runId } = await params;
  if (!isPipelineDefinitionId(id) || !/^run-[A-Za-z0-9_-]{1,123}$/.test(runId)) {
    return NextResponse.json({ error: "invalid_pipeline_run" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    (body.decision !== "approve" && body.decision !== "reject")
  ) {
    return NextResponse.json({ error: "invalid_decision" }, { status: 400 });
  }
  setGitHubContext(auth.owner, auth.repo, auth.token, auth.storeRepoUrl, auth.storeRef);
  try {
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }
    const actor = await verifyActorLogin(req, undefined);
    if (actor instanceof NextResponse) return actor;
    const result = await decidePipelineExecution({
      octokit,
      owner: auth.owner,
      repo: auth.repo,
      pipelineId: id,
      runId,
      decision: body.decision,
      decidedBy: actor.identity.login,
    });
    if (result.kind === "unavailable") {
      return NextResponse.json(
        { error: "pipeline_decision_unavailable" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, status: result.kind });
  } finally {
    clearGitHubContext();
  }
}
