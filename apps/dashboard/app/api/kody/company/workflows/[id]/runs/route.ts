import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@kody-ade/base/auth";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { isWorkflowDefinitionId } from "@dashboard/lib/workflow-definitions";
import {
  isWorkflowRunStateId,
  readLatestWorkflowRunStateFile,
  readWorkflowRunStateFile,
} from "@dashboard/lib/workflow-run-state-files";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });

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
    if (!octokit)
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    const runId = req.nextUrl.searchParams.get("runId");
    if (runId && !isWorkflowRunStateId(runId)) {
      return NextResponse.json({ error: "invalid_run_id" }, { status: 400 });
    }
    const run = runId
      ? await readWorkflowRunStateFile(auth.owner, auth.repo, id, runId)
      : await readLatestWorkflowRunStateFile(auth.owner, auth.repo, id);
    return NextResponse.json({ run });
  } catch (error) {
    return NextResponse.json(
      {
        error: "failed_to_read_workflow_run",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
