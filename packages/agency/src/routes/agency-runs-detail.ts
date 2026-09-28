/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern agency-run-detail-api
 * @ai-summary GET /api/kody/agency-runs/detail reads one run's Convex evidence.
 */
import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  verifyRepoReadAccess,
} from "@kody-ade/base/auth";
import { readAgencyRunDetail } from "../agency-runs";
import { clearGitHubContext, setGitHubContext } from "../github";

export async function GET(req: NextRequest) {
  const authError = await verifyRepoReadAccess(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const runId = req.nextUrl.searchParams.get("runId")?.trim();
  if (!runId) {
    return NextResponse.json({ error: "missing_run_id" }, { status: 400 });
  }
  const githubRunId = req.nextUrl.searchParams.get("githubRunId")?.trim();

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_user_token" }, { status: 401 });
  }

  setGitHubContext(
    headerAuth.owner,
    headerAuth.repo,
    headerAuth.token,
    headerAuth.storeRepoUrl,
    headerAuth.storeRef,
  );

  try {
    const payload = await readAgencyRunDetail({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      sourcePath: runId,
      githubRunId,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to read run detail";
    return NextResponse.json(
      {
        error: "failed_to_read_run_detail",
        message,
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
