/**
 * @fileType api-endpoint
 * @domain runner
 * @pattern fly-machines-api
 *
 * GET /api/kody/fly/machines — the operator machine inventory: every
 * kody-managed Fly machine the connected repo's token can see, classified by
 * feature (preview / runner / brain / builder). Powers the Fly Machines page.
 *
 * Auth: requireKodyAuth. Fly token: the connected repo's vault FLY_API_TOKEN
 * (same per-repo billing rule as the rest of the Fly surface).
 */
import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth, verifyActorLogin } from "@kody-ade/base/auth";
import { logger } from "@kody-ade/base/logger";
import { z } from "zod";
import {
  createManagedMachine,
  managedMachineAppName,
  visibleManagedInventory,
} from "../machines/managed";
import {
  emptyServerProviderInventory,
  listServerProviderInventoryCached,
  refreshServerProviderInventoryCounts,
} from "../infrastructure/server-brain";
import {
  serverProviderConfigFromContext,
  resolveServerProviderContext,
} from "../infrastructure/server-context";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveServerProviderContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const cfg = serverProviderConfigFromContext(ctx.context);

  const inventory = emptyServerProviderInventory();
  let inventoryErr: unknown = null;
  try {
    if (cfg) {
      const listed = await listServerProviderInventoryCached(cfg);
      inventory.machines.push(...listed.machines);
    }
  } catch (err) {
    inventoryErr = err;
  }

  if (inventory.machines.length > 0) {
    return NextResponse.json(
      visibleManagedInventory(
        refreshServerProviderInventoryCounts(inventory),
        managedMachineAppName(ctx.context.owner, ctx.context.repo, cfg!.orgSlug),
      ),
    );
  }

  if (!cfg) {
    return NextResponse.json(
      {
        error: "fly_token_missing",
        message: "FLY_API_TOKEN not in this repo's secrets vault.",
      },
      { status: 503 },
    );
  }

  if (inventoryErr) {
    logger.error(
      { err: inventoryErr, owner: ctx.context.owner, repo: ctx.context.repo },
      "fly-machines: inventory failed",
    );
    return NextResponse.json(
      { error: "inventory_failed", message: (inventoryErr as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json(inventory);
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  size: z.enum(["low", "medium", "high"]),
  region: z.string().regex(/^[a-z]{3,4}$/).optional(),
  sleepWhenIdle: z.boolean(),
  requestId: z.uuid(),
});

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const actor = await verifyActorLogin(req, undefined);
  if ("status" in actor) return actor;
  const body = CreateBody.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid_machine_settings" }, { status: 400 });
  }
  const ctx = await resolveServerProviderContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const cfg = serverProviderConfigFromContext(ctx.context);
  if (!cfg) {
    return NextResponse.json({ error: "fly_token_missing" }, { status: 503 });
  }
  try {
    const machine = await createManagedMachine({
      ...body.data,
      owner: ctx.context.owner,
      repo: ctx.context.repo,
      cfg,
    });
    return NextResponse.json(machine, { status: 201 });
  } catch (err) {
    logger.error(
      { err, owner: ctx.context.owner, repo: ctx.context.repo },
      "fly-machines: create failed",
    );
    return NextResponse.json(
      { error: "machine_creation_failed", message: "Could not create the machine. Check your Fly token, region, and available capacity." },
      { status: 502 },
    );
  }
}
