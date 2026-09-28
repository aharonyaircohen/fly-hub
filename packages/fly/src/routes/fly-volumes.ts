/**
 * @fileType api-endpoint
 * @domain infrastructure
 * @pattern fly-volumes-api
 * @ai-summary Lists and operates persistent volumes owned by Kody-managed Fly apps.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireKodyAuth, verifyActorLogin } from "@kody-ade/base/auth";
import { logger } from "@kody-ade/base/logger";
import {
  deleteVolume,
  listVolumes,
  snapshotVolume,
} from "../apps/resources-client";
import {
  serverProviderConfigFromContext,
  resolveServerProviderContext,
} from "../infrastructure/server-context";
import { classifyApp } from "../plugin/runners/inventory";
import { listAppsByPrefix } from "../plugin/previews/machines-client";

export const runtime = "nodejs";

type RawVolume = {
  id?: string;
  name?: string;
  region?: string;
  state?: string;
  size_gb?: number;
  encrypted?: boolean;
  attached_machine_id?: string | null;
  created_at?: string;
};

const ActionBody = z.object({
  app: z.string().min(1).max(120),
  volumeId: z.string().min(1).max(120),
  action: z.enum(["snapshot", "delete"]),
  actorLogin: z.string().optional(),
});

function isKodyManagedApp(app: string): boolean {
  return classifyApp(app).feature !== "other";
}

function rawVolumes(value: unknown): RawVolume[] {
  if (Array.isArray(value)) return value as RawVolume[];
  if (value && typeof value === "object" && "volumes" in value) {
    const volumes = (value as { volumes?: unknown }).volumes;
    return Array.isArray(volumes) ? (volumes as RawVolume[]) : [];
  }
  return [];
}

async function context(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return { response: authError } as const;
  const resolved = await resolveServerProviderContext(req);
  if (!resolved.ok)
    return {
      response: NextResponse.json(
        { error: resolved.error },
        { status: resolved.status },
      ),
    } as const;
  const cfg = serverProviderConfigFromContext(resolved.context);
  if (!cfg)
    return {
      response: NextResponse.json(
        { error: "fly_token_missing" },
        { status: 503 },
      ),
    } as const;
  return { cfg } as const;
}

export async function GET(req: NextRequest) {
  const resolved = await context(req);
  if ("response" in resolved) return resolved.response;
  try {
    const apps = (await listAppsByPrefix("", resolved.cfg)).filter(
      isKodyManagedApp,
    );
    const rows = await Promise.all(
      apps.map(async (app) => {
        try {
          const volumes = rawVolumes(await listVolumes(app, resolved.cfg));
          return {
            volumes: volumes
              .filter((volume) => Boolean(volume.id))
              .map((volume) => ({
                app,
                id: volume.id!,
                name: volume.name ?? volume.id!,
                region: volume.region ?? "unknown",
                state: volume.state ?? "unknown",
                sizeGb: volume.size_gb ?? 0,
                encrypted: volume.encrypted === true,
                attachedMachineId: volume.attached_machine_id ?? null,
                createdAt: volume.created_at ?? null,
              })),
          };
        } catch {
          return { volumes: [], unavailableApp: app };
        }
      }),
    );
    return NextResponse.json(
      {
        volumes: rows.flatMap((row) => row.volumes),
        unavailableApps: rows.flatMap((row) =>
          row.unavailableApp ? [row.unavailableApp] : [],
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error({ err: error }, "fly-volumes: inventory failed");
    return NextResponse.json(
      { error: "volume_inventory_failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const resolved = await context(req);
  if ("response" in resolved) return resolved.response;
  const parsed = ActionBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  const { app, volumeId, action, actorLogin } = parsed.data;
  if (!isKodyManagedApp(app))
    return NextResponse.json({ error: "volume_not_found" }, { status: 404 });
  try {
    const apps = await listAppsByPrefix("", resolved.cfg);
    if (!apps.includes(app))
      return NextResponse.json({ error: "volume_not_found" }, { status: 404 });
    const volumes = rawVolumes(await listVolumes(app, resolved.cfg));
    const volume = volumes.find((item) => item.id === volumeId);
    if (!volume)
      return NextResponse.json({ error: "volume_not_found" }, { status: 404 });
    if (action === "snapshot") {
      await snapshotVolume(app, volumeId, resolved.cfg);
    } else {
      const verified = await verifyActorLogin(req, actorLogin);
      if ("status" in verified) return verified;
      if (volume.attached_machine_id)
        return NextResponse.json({ error: "volume_attached" }, { status: 409 });
      await snapshotVolume(app, volumeId, resolved.cfg);
      await deleteVolume(app, volumeId, resolved.cfg);
    }
    return NextResponse.json({ ok: true, app, volumeId, action });
  } catch (error) {
    logger.error(
      { err: error, app, volumeId, action },
      "fly-volumes: action failed",
    );
    return NextResponse.json(
      { error: "volume_action_failed" },
      { status: 500 },
    );
  }
}
