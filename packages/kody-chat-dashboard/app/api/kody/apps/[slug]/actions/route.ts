import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  listMachines,
  startMachine,
  stopMachine,
  waitForMachineStarted,
} from "@kody-ade/fly/apps/machines-client";
import { resolveAppHostingConfig } from "@kody-ade/fly/apps/config";
import { checkAppRateLimit } from "../../../../../../src/dashboard/lib/apps/rate-limit";
import {
  AppDeploymentError,
  startAppDeployment,
} from "../../../../../../src/dashboard/lib/apps/deployment-service";

const schema = z.object({ action: z.enum(["start", "stop", "restart"]) });
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "invalid_app_action" }, { status: 400 });
  const { slug } = await params,
    tenantId = `${access.auth.owner}/${access.auth.repo}`,
    backend = createBackendClient();
  if (
    !(await checkAppRateLimit({
      tenantId,
      actor: access.actorLogin,
      action: "lifecycle",
      limit: 30,
    }))
  )
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const app = await backend.query(backendApi.apps.get, { tenantId, slug });
  if (!app)
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  const cfg = resolveAppHostingConfig();
  if (!cfg)
    return NextResponse.json(
      { error: "app_hosting_unavailable" },
      { status: 503 },
    );
  const machines = await listMachines(app.provider.appName, cfg);
  if (!machines.length && input.data.action === "start") {
    const deployments = await backend.query(backendApi.appDeployments.list, {
      tenantId,
      appId: app.appId,
    });
    const latest = deployments[0];
    if (!latest?.commitSha)
      return NextResponse.json(
        { error: "app_deployment_missing" },
        { status: 409 },
      );
    try {
      const result = await startAppDeployment({
        access,
        tenantId,
        app,
        requestId: crypto.randomUUID(),
        commitSha: latest.commitSha,
        buildPlan: latest.buildPlan,
        callbackOrigin:
          process.env.KODY_PUBLIC_BASE_URL ??
          (process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : new URL(req.url).origin),
        action: "start_repair",
      });
      return NextResponse.json(
        {
          deploymentId: result.deploymentId,
          status: "deploying",
          repairing: true,
        },
        { status: 202 },
      );
    } catch (error) {
      if (error instanceof AppDeploymentError)
        return NextResponse.json(
          { error: error.code, ...error.details },
          { status: error.status },
        );
      console.error("[Apps] Start recovery failed", error);
      return NextResponse.json({ error: "app_setup_failed" }, { status: 502 });
    }
  }
  if (!machines.length)
    return NextResponse.json({ error: "app_machine_missing" }, { status: 409 });
  const requestId = crypto.randomUUID(),
    startedAt = new Date().toISOString();
  try {
    await backend.mutation(backendApi.apps.beginAction, {
      tenantId,
      appId: app.appId,
      requestId,
      action: input.data.action,
      startedAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("APP_ACTION_CONFLICT"))
      return NextResponse.json(
        { error: "app_action_conflict" },
        { status: 409 },
      );
    throw error;
  }
  try {
    if (input.data.action !== "start")
      await Promise.all(
        machines.map((machine) =>
          stopMachine(app.provider.appName, machine.id, cfg),
        ),
      );
    if (input.data.action !== "stop") {
      await Promise.all(
        machines.map((machine) =>
          startMachine(app.provider.appName, machine.id, cfg),
        ),
      );
      await Promise.all(
        machines.map((machine) =>
          waitForMachineStarted(app.provider.appName, machine.id, cfg),
        ),
      );
    }
    const observedStatus = input.data.action === "stop" ? "stopped" : "running";
    await backend.mutation(backendApi.apps.transition, {
      tenantId,
      appId: app.appId,
      desiredStatus: input.data.action === "stop" ? "stopped" : "running",
      observedStatus,
      updatedAt: new Date().toISOString(),
    });
    await backend.mutation(backendApi.apps.endAction, {
      tenantId,
      appId: app.appId,
      requestId,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, status: observedStatus });
  } catch {
    await backend.mutation(backendApi.apps.endAction, {
      tenantId,
      appId: app.appId,
      requestId,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ error: "app_action_failed" }, { status: 502 });
  }
}
