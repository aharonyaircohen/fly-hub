import { NextRequest, NextResponse } from "next/server";

import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@kody-ade/base/auth";
import {
  actionSchema,
  journeySchema,
  scenarioSchema,
} from "../../../../../src/dashboard/lib/quality/contracts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "no-store, max-age=0" };
const resources = ["actions", "journeys", "scenarios", "runs"] as const;
type QualityResource = (typeof resources)[number];

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers });
}

function tenant(req: NextRequest) {
  const auth = getRequestAuth(req);
  return auth ? `${auth.owner}/${auth.repo}` : null;
}

function isResource(value: string): value is QualityResource {
  return resources.includes(value as QualityResource);
}

async function currentSourceCommit(req: NextRequest) {
  const auth = getRequestAuth(req);
  if (!auth) return null;
  try {
    const octokit = await getUserOctokit(req);
    if (!octokit) return null;
    const repository = await octokit.rest.repos.get({
      owner: auth.owner,
      repo: auth.repo,
    });
    const commit = await octokit.rest.repos.getCommit({
      owner: auth.owner,
      repo: auth.repo,
      ref: repository.data.default_branch || "main",
    });
    return commit.data.sha;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const tenantId = tenant(req);
  if (!tenantId) return json({ error: "missing_repo_context" }, 400);
  const { resource } = await context.params;
  if (!isResource(resource)) return json({ error: "not_found" }, 404);

  try {
    const client = createBackendClient();
    const [map, runs, sourceCommit] = await Promise.all([
      client.query(backendApi.quality.getMap, { tenantId }),
      client.query(backendApi.quality.listRuns, { tenantId }),
      currentSourceCommit(req),
    ]);
    return json({ ...map, runs, currentSourceCommit: sourceCommit });
  } catch (error) {
    console.error("[quality] list failed", { resource, error });
    return json({ error: "quality_unavailable" }, 500);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const tenantId = tenant(req);
  if (!tenantId) return json({ error: "missing_repo_context" }, 400);
  const { resource } = await context.params;
  if (!isResource(resource) || resource === "runs") {
    return json({ error: "not_found" }, 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const updatedAt = new Date().toISOString();
  const schema =
    resource === "actions"
      ? actionSchema
      : resource === "journeys"
        ? journeySchema
        : scenarioSchema;
  const parsed = schema.safeParse({
    ...(typeof body === "object" && body !== null ? body : {}),
    updatedAt,
  });
  if (!parsed.success) {
    return json(
      { error: "validation_error", details: parsed.error.issues },
      400,
    );
  }

  try {
    const client = createBackendClient();
    const result =
      resource === "actions"
        ? await client.mutation(backendApi.quality.saveAction, {
            tenantId,
            ...actionSchema.parse(parsed.data),
          })
        : resource === "journeys"
          ? await client.mutation(backendApi.quality.saveJourney, {
              tenantId,
              ...journeySchema.parse(parsed.data),
            })
          : await client.mutation(backendApi.quality.saveScenario, {
              tenantId,
              ...scenarioSchema.parse(parsed.data),
            });
    return json({ ok: true, result }, 201);
  } catch (error) {
    console.error("[quality] save failed", { resource, error });
    return json({ error: "quality_save_failed" }, 409);
  }
}
