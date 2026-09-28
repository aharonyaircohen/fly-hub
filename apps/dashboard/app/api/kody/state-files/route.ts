/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern state-file-view-api
 * @ai-summary GET /api/kody/state-files resolves legacy evidence paths from
 *   the Convex runtime tables; GitHub state-file reads are retired.
 */
import { NextRequest, NextResponse } from "next/server";

import { getRequestAuth, verifyRepoReadAccess } from "@kody-ade/base/auth";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

function parseRequestedPath(req: NextRequest): string | null {
  const raw = req.nextUrl.searchParams.get("path")?.trim();
  if (!raw) return null;
  const normalized = raw.replace(/^\/+|\/+$/g, "");
  if (
    !normalized ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    normalized
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid backend document path");
  }
  return normalized;
}

export async function GET(req: NextRequest) {
  const authError = await verifyRepoReadAccess(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let path: string | null = null;
  try {
    path = parseRequestedPath(req);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "invalid_path",
        message:
          error instanceof Error ? error.message : "Invalid state file path",
      },
      { status: 400 },
    );
  }
  if (!path) {
    return NextResponse.json({ error: "missing_path" }, { status: 400 });
  }

  try {
    const tenantId = `${headerAuth.owner}/${headerAuth.repo}`;
    const workflowMatch = path.match(
      /^logs\/workflows\/([^/]+)\/runs\/([^/]+?)(?:\.jsonl)?$/,
    );
    if (workflowMatch) {
      const workflowId = workflowMatch[1]!;
      const runId = workflowMatch[2]!;
      const state = await createBackendClient().query(api.workflowRuns.get, {
        tenantId,
        workflowId,
        runId,
      });
      if (!state)
        return NextResponse.json(
          { error: "state_file_not_found", path },
          { status: 404 },
        );
      return NextResponse.json({
        requestedPath: path,
        path,
        content: JSON.stringify(state.state, null, 2),
        sha: null,
        htmlUrl: null,
        size: JSON.stringify(state.state).length,
      });
    }
    const doc = await createBackendClient().query(api.repoDocs.get, {
      tenantId,
      kind: path,
    });
    if (!doc) {
      return NextResponse.json(
        { error: "legacy_state_path", path },
        { status: 404 },
      );
    }
    const content =
      typeof (doc as { doc?: unknown }).doc === "string"
        ? (doc as { doc: string }).doc
        : JSON.stringify((doc as { doc: unknown }).doc, null, 2);
    return NextResponse.json(
      {
        requestedPath: path,
        path,
        content,
        sha: null,
        htmlUrl: null,
        size: content.length,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "failed_to_read_state_file",
        message:
          error instanceof Error ? error.message : "Failed to read state file",
      },
      { status: 500 },
    );
  }
}
