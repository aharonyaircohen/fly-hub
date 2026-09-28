import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import {
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
} from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { destroyApp } from "@kody-ade/fly/apps/machines-client";
import { resolveAppHostingConfig } from "@kody-ade/fly/apps/config";
import { POST as deployApp } from "./deployments/route";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    branch: z.string().trim().min(1).max(240).optional(),
    exposure: z.enum(["private", "public"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
const noStore = { "Cache-Control": "no-store, max-age=0" };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const access = await verifyRepoReadAccess(req);
  if (access instanceof NextResponse) return access;
  const { slug } = await params,
    tenantId = `${access.auth.owner}/${access.auth.repo}`;
  const app = await createBackendClient().query(backendApi.apps.get, {
    tenantId,
    slug,
  });
  if (!app)
    return NextResponse.json(
      { error: "app_not_found" },
      { status: 404, headers: noStore },
    );
  const { accessTokens, ...safeApp } = app as typeof app & {
    accessTokens: Array<Record<string, unknown>>;
  };
  return NextResponse.json(
    {
      app: {
        ...safeApp,
        accessTokens: accessTokens.map(
          ({ tokenHash: _hash, ...token }) => token,
        ),
      },
    },
    { headers: noStore },
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const input = patchSchema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "invalid_app_update" }, { status: 400 });
  const { slug } = await params,
    tenantId = `${access.auth.owner}/${access.auth.repo}`,
    backend = createBackendClient();
  const app = await backend.query(backendApi.apps.get, { tenantId, slug });
  if (!app)
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  const { exposure, ...values } = input.data;
  await backend.mutation(backendApi.apps.patch, {
    tenantId,
    appId: app.appId,
    ...values,
    updatedAt: new Date().toISOString(),
  });
  if (exposure && exposure !== app.exposure) {
    const deployment = app.currentDeploymentId
      ? await backend.query(backendApi.appDeployments.get, {
          tenantId,
          appId: app.appId,
          deploymentId: app.currentDeploymentId,
        })
      : null;
    if (!deployment)
      return NextResponse.json(
        { error: "app_deployment_required" },
        { status: 409 },
      );
    await backend.mutation(backendApi.apps.setExposure, {
      tenantId,
      appId: app.appId,
      exposure,
      updatedAt: new Date().toISOString(),
    });
    const deployReq = new NextRequest(req.nextUrl, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        commitSha: deployment.commitSha,
      }),
    });
    const response = await deployApp(deployReq, {
      params: Promise.resolve({ slug }),
    });
    if (!response.ok)
      await backend.mutation(backendApi.apps.setExposure, {
        tenantId,
        appId: app.appId,
        exposure: app.exposure,
        updatedAt: new Date().toISOString(),
      });
    return response;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const body = (await req.json().catch(() => ({}))) as {
    deleteStorage?: boolean;
  };
  const { slug } = await params,
    tenantId = `${access.auth.owner}/${access.auth.repo}`,
    backend = createBackendClient();
  const app = await backend.query(backendApi.apps.get, { tenantId, slug });
  if (!app)
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  if (app.storage.length && !body.deleteStorage)
    return NextResponse.json(
      { error: "storage_confirmation_required" },
      { status: 409 },
    );
  const cfg = resolveAppHostingConfig();
  if (!cfg)
    return NextResponse.json(
      { error: "app_hosting_unavailable" },
      { status: 503 },
    );
  const requestId = crypto.randomUUID();
  try {
    await backend.mutation(backendApi.apps.beginAction, {
      tenantId,
      appId: app.appId,
      requestId,
      action: "delete",
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("APP_ACTION_CONFLICT"))
      return NextResponse.json(
        { error: "app_action_conflict" },
        { status: 409 },
      );
    throw error;
  }
  await backend.mutation(backendApi.apps.transition, {
    tenantId,
    appId: app.appId,
    observedStatus: "deleting",
    desiredStatus: "deleted",
    updatedAt: new Date().toISOString(),
  });
  try {
    await destroyApp(app.provider.appName, cfg);
    await backend.mutation(backendApi.apps.transition, {
      tenantId,
      appId: app.appId,
      observedStatus: "deleted",
      updatedAt: new Date().toISOString(),
    });
    await backend.mutation(backendApi.apps.endAction, {
      tenantId,
      appId: app.appId,
      requestId,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    await backend.mutation(backendApi.apps.transition, {
      tenantId,
      appId: app.appId,
      observedStatus: "failed",
      updatedAt: new Date().toISOString(),
    });
    await backend.mutation(backendApi.apps.endAction, {
      tenantId,
      appId: app.appId,
      requestId,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ error: "app_delete_failed" }, { status: 502 });
  }
}
