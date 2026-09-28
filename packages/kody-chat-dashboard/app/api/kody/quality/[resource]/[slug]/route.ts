import { NextRequest, NextResponse } from "next/server";

import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { getRequestAuth, requireKodyAuth } from "@kody-ade/base/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "no-store, max-age=0" };

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ resource: string; slug: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json(
      { error: "missing_repo_context" },
      { status: 400, headers },
    );
  }
  const { resource, slug } = await context.params;
  if (resource !== "runs") {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400, headers },
    );
  }
  const runId =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { runId?: unknown }).runId === "string"
      ? (body as { runId: string }).runId.trim()
      : "";
  const action =
    typeof body === "object" && body !== null
      ? (body as { action?: unknown }).action
      : undefined;
  const archived =
    typeof body === "object" && body !== null
      ? (body as { archived?: unknown }).archived
      : undefined;
  if (!runId || (action !== "cancel" && typeof archived !== "boolean")) {
    return NextResponse.json(
      { error: "validation_error" },
      { status: 400, headers },
    );
  }

  try {
    if (action === "cancel") {
      await createBackendClient().mutation(backendApi.quality.updateRun, {
        tenantId: `${auth.owner}/${auth.repo}`,
        runId,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: "Cancelled by user",
      });
      return NextResponse.json({ ok: true, status: "cancelled" }, { headers });
    }
    if (typeof archived !== "boolean") {
      return NextResponse.json(
        { error: "validation_error" },
        { status: 400, headers },
      );
    }
    await createBackendClient().mutation(backendApi.quality.setRunArchived, {
      tenantId: `${auth.owner}/${auth.repo}`,
      runId,
      runSlug: slug,
      archived,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, archived }, { headers });
  } catch (error) {
    console.error("[quality] archive failed", { slug, error });
    return NextResponse.json(
      { error: "quality_run_not_found" },
      { status: 404, headers },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ resource: string; slug: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json(
      { error: "missing_repo_context" },
      { status: 400, headers },
    );
  }
  const tenantId = `${auth.owner}/${auth.repo}`;
  const { resource, slug } = await context.params;
  const operation =
    resource === "actions"
      ? backendApi.quality.removeAction
      : resource === "journeys"
        ? backendApi.quality.removeJourney
        : resource === "scenarios"
          ? backendApi.quality.removeScenario
          : null;
  if (!operation) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  }

  try {
    const removed = await createBackendClient().mutation(operation, {
      tenantId,
      slug,
    });
    if (!removed) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers },
      );
    }
    return new NextResponse(null, { status: 204, headers });
  } catch (error) {
    console.error("[quality] delete blocked", { resource, slug, error });
    return NextResponse.json(
      { error: "quality_definition_referenced" },
      { status: 409, headers },
    );
  }
}
