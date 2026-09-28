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

import { requireKodyAuth } from "@kody-ade/base/auth";
import { logger } from "@kody-ade/base/logger";
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
    return NextResponse.json(refreshServerProviderInventoryCounts(inventory));
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
