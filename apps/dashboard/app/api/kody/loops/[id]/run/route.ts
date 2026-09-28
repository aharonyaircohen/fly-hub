import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@kody-ade/base/auth";
import { readRepositoryLoop } from "@dashboard/lib/repository-loops";
import { createGitHubActionsEngineGateway } from "@dashboard/features/workflows/server/github-actions-engine-gateway";
import { startLoop } from "@dashboard/features/workflows/server/start-loop";
import { authorizeLoopExecution } from "@dashboard/features/workflows/server/workflow-execution-authorization";

const LOOP_ID = /^[a-z][a-z0-9-]{0,127}$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  const octokit = await getUserOctokit(req);
  const { id } = await params;
  if (!auth || !octokit || !LOOP_ID.test(id)) {
    return NextResponse.json({ error: "invalid_loop" }, { status: 400 });
  }

  let approved = false;
  try {
    approved = (await req.json())?.approved === true;
  } catch {
    // Empty body means approval was not provided.
  }

  try {
    const result = await startLoop(
      { loopId: id, source: "dashboard", approved },
      {
        createRequestId: () => `run-${randomUUID()}`,
        loadLoop: (loopId) =>
          readRepositoryLoop(octokit, auth.owner, auth.repo, loopId),
        authorize: authorizeLoopExecution,
        dispatch: createGitHubActionsEngineGateway({
          octokit,
          owner: auth.owner,
          repo: auth.repo,
        }),
      },
    );
    if (result.kind === "not-found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (result.kind === "disabled") {
      return NextResponse.json({ error: "loop_disabled" }, { status: 409 });
    }
    if (result.kind === "approval-required") {
      return NextResponse.json({ error: "approval_required" }, { status: 409 });
    }
    return NextResponse.json(
      {
        ok: true,
        execution: "kody-engine",
        loop: id,
        runId: result.requestId,
        acceptedAt: result.acceptedAt,
      },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "dispatch_failed",
        message:
          error instanceof Error ? error.message : "Failed to dispatch Loop",
      },
      { status: 500 },
    );
  }
}
