import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { resolveAppHostingConfig } from "@kody-ade/fly/apps/config";
import {
  createVolume,
  deleteVolume,
  snapshotVolume,
} from "@kody-ade/fly/apps/resources-client";
import {
  destroyMachine,
  listMachines,
} from "@kody-ade/fly/apps/machines-client";
import { POST as deployApp } from "../deployments/route";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    mountPath: z.string().startsWith("/").max(200),
    sizeGb: z.number().int().min(1).max(500),
    region: z
      .string()
      .regex(/^[a-z]{3}$/)
      .optional(),
  }),
  z.object({
    action: z.literal("snapshot"),
    volumeId: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("delete"),
    volumeId: z.string().min(1).max(100),
    confirm: z.literal(true),
  }),
]);
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "invalid_app_storage_action" },
      { status: 400 },
    );
  const tenantId = `${access.auth.owner}/${access.auth.repo}`,
    { slug } = await params,
    backend = createBackendClient(),
    app = await backend.query(backendApi.apps.get, { tenantId, slug });
  if (!app)
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  if (app.currentAction)
    return NextResponse.json({ error: "app_action_conflict" }, { status: 409 });
  const cfg = resolveAppHostingConfig();
  if (!cfg)
    return NextResponse.json(
      { error: "app_hosting_unavailable" },
      { status: 503 },
    );
  const redeploySource =
    input.data.action === "create" || input.data.action === "delete"
      ? app.currentDeploymentId
        ? await backend.query(backendApi.appDeployments.get, {
            tenantId,
            appId: app.appId,
            deploymentId: app.currentDeploymentId,
          })
        : null
      : null;
  if (
    (input.data.action === "create" || input.data.action === "delete") &&
    !redeploySource
  )
    return NextResponse.json(
      { error: "app_deployment_required" },
      { status: 409 },
    );
  try {
    let storage = app.storage;
    if (input.data.action === "create") {
      const volume = (await createVolume(
        app.provider.appName,
        {
          name: input.data.name,
          region: input.data.region ?? cfg.defaultRegion,
          sizeGb: input.data.sizeGb,
        },
        cfg,
      )) as { id: string; name: string; region: string; size_gb: number };
      storage = [
        ...storage,
        {
          volumeId: volume.id,
          name: volume.name,
          mountPath: input.data.mountPath,
          region: volume.region,
          sizeGb: volume.size_gb,
          status: "created",
        },
      ];
    }
    if (input.data.action === "snapshot")
      await snapshotVolume(app.provider.appName, input.data.volumeId, cfg);
    if (input.data.action === "delete") {
      const volumeId = input.data.volumeId;
      await snapshotVolume(app.provider.appName, volumeId, cfg);
      const machines = await listMachines(app.provider.appName, cfg);
      await Promise.all(
        machines.map((machine) =>
          destroyMachine(app.provider.appName, machine.id, cfg),
        ),
      );
      await deleteVolume(app.provider.appName, volumeId, cfg);
      storage = storage.filter(
        (item: { volumeId: string }) => item.volumeId !== volumeId,
      );
    }
    await backend.mutation(backendApi.apps.patch, {
      tenantId,
      appId: app.appId,
      storage,
      updatedAt: new Date().toISOString(),
    });
    if (input.data.action === "create" || input.data.action === "delete") {
      const deployReq = new NextRequest(req.nextUrl, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          commitSha: redeploySource!.commitSha,
        }),
      });
      return deployApp(deployReq, { params: Promise.resolve({ slug }) });
    }
    return NextResponse.json({ ok: true, storage });
  } catch {
    return NextResponse.json(
      { error: "app_storage_action_failed" },
      { status: 502 },
    );
  }
}
