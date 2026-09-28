/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern github-workflow-options-api
 * @ai-summary Lists the connected repository's GitHub Actions workflows for
 *   trigger configuration. The response is deliberately smaller than the
 *   GitHub API object and is safe to cache briefly in the browser.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@kody-ade/base/auth";

function githubError(error: unknown) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? (error as { message?: unknown }).message
      : undefined;

  if (status === 401) {
    return NextResponse.json(
      { error: "github_token_expired" },
      { status: 401 },
    );
  }
  if (
    status === 403 ||
    (typeof message === "string" && message.toLowerCase().includes("rate limit"))
  ) {
    return NextResponse.json(
      { error: "rate_limited", message: "GitHub API rate limit exceeded" },
      { status: 429 },
    );
  }
  return NextResponse.json(
    { error: "failed_to_list_github_workflows" },
    { status: 500 },
  );
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_user_token" }, { status: 401 });
  }

  try {
    const { data } = await octokit.actions.listRepoWorkflows({
      owner: auth.owner,
      repo: auth.repo,
      per_page: 100,
    });

    const workflows = data.workflows
      .filter(
        (workflow) =>
          typeof workflow.id === "number" &&
          typeof workflow.name === "string" &&
          typeof workflow.path === "string",
      )
      .map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        path: workflow.path,
        state: workflow.state,
      }));

    return NextResponse.json(
      { workflows },
      {
        headers: {
          "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    return githubError(error);
  }
}
