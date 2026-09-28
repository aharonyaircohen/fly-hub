import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
const schema = z.object({
  tenantId: z.string(),
  appId: z.string().uuid(),
  deploymentId: z.string().uuid(),
  requestId: z.string().uuid(),
  status: z.enum(["verifying", "running", "failed"]),
  runtimeMachineId: z.string().optional(),
  gatewayMachineId: z.string().optional(),
  imageRef: z.string().optional(),
  errorCode: z.string().max(80).optional(),
});
function valid(token: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return false;
  const a = crypto.createHash("sha256").update(token).digest(),
    b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export async function POST(req: NextRequest) {
  const token = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!token)
    return NextResponse.json(
      { error: "callback_token_required" },
      { status: 401 },
    );
  const input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "invalid_app_event" }, { status: 400 });
  const backend = createBackendClient(),
    deployment = await backend.query(backendApi.appDeployments.get, {
      tenantId: input.data.tenantId,
      appId: input.data.appId,
      deploymentId: input.data.deploymentId,
    });
  if (
    !deployment ||
    deployment.requestId !== input.data.requestId ||
    !deployment.callbackTokenHash ||
    !valid(token, deployment.callbackTokenHash)
  )
    return NextResponse.json(
      { error: "invalid_callback_token" },
      { status: 401 },
    );
  const app = await backend.query(backendApi.apps.getById, {
    tenantId: input.data.tenantId,
    appId: input.data.appId,
  });
  if (!app)
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  const now = new Date().toISOString(),
    verifying = input.data.status === "verifying",
    running = input.data.status === "running";
  await backend.mutation(backendApi.appDeployments.update, {
    tenantId: input.data.tenantId,
    appId: input.data.appId,
    deploymentId: input.data.deploymentId,
    status: verifying ? "verifying" : running ? "running" : "failed",
    stages: [
      ...(deployment.stages ?? []),
      {
        name: verifying
          ? "verification_started"
          : running
            ? "verification_passed"
            : "verification_failed",
        status: verifying || running ? "complete" : "failed",
        at: now,
        ...(input.data.errorCode ? { errorCode: input.data.errorCode } : {}),
      },
    ],
    ...(input.data.runtimeMachineId
      ? { runtimeMachineId: input.data.runtimeMachineId }
      : {}),
    ...(input.data.imageRef ? { imageRef: input.data.imageRef } : {}),
    ...(input.data.errorCode ? { error: { code: input.data.errorCode } } : {}),
    updatedAt: now,
    ...(!verifying ? { completedAt: now } : {}),
  });
  if (!verifying)
    await backend.mutation(backendApi.apps.transition, {
      tenantId: input.data.tenantId,
      appId: input.data.appId,
      observedStatus: running ? "running" : "failed",
      updatedAt: now,
    });
  if (!verifying)
    await backend.mutation(backendApi.apps.endAction, {
      tenantId: input.data.tenantId,
      appId: input.data.appId,
      requestId: input.data.requestId,
      updatedAt: now,
    });
  await backend.mutation(backendApi.appEvents.append, {
    tenantId: input.data.tenantId,
    appId: input.data.appId,
    eventId: `deployment:${input.data.deploymentId}:${input.data.status}`,
    kind: `deployment.${input.data.status}`,
    actor: { type: "system", id: "fly-builder" },
    payload: {
      deploymentId: input.data.deploymentId,
      ...(input.data.errorCode ? { errorCode: input.data.errorCode } : {}),
    },
    timestamp: now,
  });
  if (!verifying)
    await backend.mutation(backendApi.inbox.upsert, {
      tenantId: input.data.tenantId,
      login: app.createdBy,
      entryId: `app-deployment-${input.data.deploymentId}`,
      entry: {
        id: `app-deployment-${input.data.deploymentId}`,
        source: "kody",
        repoFullName: input.data.tenantId,
        threadType: "app",
        title: `${app.name} deployment ${running ? "completed" : "failed"}`,
        snippet: running
          ? "The App is healthy and ready."
          : `Deployment failed${input.data.errorCode ? `: ${input.data.errorCode}` : "."}`,
        url: `/repo/${input.data.tenantId}/apps/${app.slug}`,
        sentAt: now,
        readAt: null,
        category: "apps",
      },
      sentAt: now,
    });
  return NextResponse.json({ ok: true });
}
