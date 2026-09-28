/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern pipeline-api
 * @ai-summary API route to fetch pipeline status for a task
 */
import { NextRequest, NextResponse } from "next/server";

import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import { pipelineParamsSchema } from "@dashboard/lib/schemas";
import { apiValidationError } from "@dashboard/lib/api-responses";
import { requireKodyAuth, getRequestAuth } from "@kody-ade/base/auth";
import {
  getStatusFromBranch,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  // Check auth
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  // Validate path params
  const { taskId: rawTaskId } = await params;
  const parsed = pipelineParamsSchema.safeParse({ taskId: rawTaskId });
  if (!parsed.success) {
    return apiValidationError(
      parsed.error.issues.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
    );
  }
  const { taskId } = parsed.data;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const status = await getStatusFromBranch(taskId, "");
    if (status) {
      return NextResponse.json({
        status,
        source: "backend",
      });
    }

    // No status found
    return NextResponse.json({
      status: null,
      source: null,
    });
  } catch (error: unknown) {
    return handleKodyApiError(error, "pipeline");
  } finally {
    clearGitHubContext();
  }
}
