import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
} from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  AppDeploymentError,
  startAppDeployment,
} from "../../../../../../src/dashboard/lib/apps/deployment-service";
import { checkAppRateLimit } from "../../../../../../src/dashboard/lib/apps/rate-limit";
import { inspectRepositoryApp } from "../../../../../../src/dashboard/lib/apps/source-inspection";
import { parseGitHubRepository } from "../../../../../../src/dashboard/lib/apps/source-repository";

const deploySchema = z
  .object({
    requestId: z.string().uuid(),
    commitSha: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    rollbackDeploymentId: z.string().uuid().optional(),
  })
  .refine(
    (value) => Boolean(value.commitSha) !== Boolean(value.rollbackDeploymentId),
  );

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const access = await verifyRepoReadAccess(req);
  if (access instanceof NextResponse) return access;
  const tenantId = `${access.auth.owner}/${access.auth.repo}`;
  const { slug } = await params;
  const backend = createBackendClient();
  const app = await backend.query(backendApi.apps.get, { tenantId, slug });
  if (!app)
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  const deployments = await backend.query(backendApi.appDeployments.list, {
    tenantId,
    appId: app.appId,
  });
  return NextResponse.json(
    {
      deployments: deployments.map(
        ({ callbackTokenHash: _callback, ...deployment }) => deployment,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const input = deploySchema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "invalid_app_deployment" },
      { status: 400 },
    );
  const tenantId = `${access.auth.owner}/${access.auth.repo}`;
  const { slug } = await params;
  const backend = createBackendClient();
  const app = await backend.query(backendApi.apps.get, { tenantId, slug });
  if (!app)
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  if (
    !(await checkAppRateLimit({
      tenantId,
      actor: access.actorLogin,
      action: "deploy",
      windowSec: 3600,
      limit: 20,
    }))
  )
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  let commitSha = input.data.commitSha;
  let buildPlan = app.detectedConfig;
  let deploymentApp = app;
  let action: "deploy" | "rollback" = "deploy";
  if (input.data.rollbackDeploymentId) {
    const prior = await backend.query(backendApi.appDeployments.get, {
      tenantId,
      appId: app.appId,
      deploymentId: input.data.rollbackDeploymentId,
    });
    if (!prior || prior.status !== "running")
      return NextResponse.json(
        { error: "rollback_deployment_unavailable" },
        { status: 409 },
      );
    commitSha = prior.commitSha;
    buildPlan = prior.buildPlan;
    action = "rollback";
  } else {
    const source = parseGitHubRepository(app.repository);
    const inspected = await inspectRepositoryApp({
      octokit: access.octokit,
      owner: source.owner,
      repo: source.repo,
      rootDirectory: app.rootDirectory,
      ref: commitSha,
      name: app.name,
    });
    buildPlan = inspected.plan;
    deploymentApp = {
      ...app,
      secretNames: inspected.requiredSecretNames,
    };
    await backend.mutation(backendApi.apps.patch, {
      tenantId,
      appId: app.appId,
      detectedConfig: buildPlan,
      secretNames: inspected.requiredSecretNames,
      updatedAt: new Date().toISOString(),
    });
  }

  try {
    const result = await startAppDeployment({
      access,
      tenantId,
      app: deploymentApp,
      requestId: input.data.requestId,
      commitSha: commitSha!,
      buildPlan,
      callbackOrigin:
        process.env.KODY_PUBLIC_BASE_URL ??
        (process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : new URL(req.url).origin),
      action,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof AppDeploymentError)
      return NextResponse.json(
        { error: error.code, ...error.details },
        { status: error.status },
      );
    console.error("[Apps] deployment failed", error);
    return NextResponse.json({ error: "app_setup_failed" }, { status: 502 });
  }
}
