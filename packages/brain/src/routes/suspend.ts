/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-suspend
 *
 * POST /api/kody/brain/suspend
 *
 * Snapshot-pause the per-user Brain Fly machine. Idempotent — returns 200
 * when no machine exists or it's already suspended. Resume happens either
 * via the Settings Resume button (POST /api/kody/brain/resume) or
 * automatically on the next chat request (autostart=true on the service).
 */

import { NextRequest, NextResponse } from "next/server";

import { manageBrainServer } from "../server-commands";
import { logger } from "@kody-ade/base/logger";
import { resolvePersonalBrainContext } from "../personal-context";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = await resolvePersonalBrainContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error: "Fly token missing — add FLY_API_TOKEN to Personal Credentials.",
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await manageBrainServer({ command: "suspend", context: ctx.context }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId: ctx.context.userId }, "brain suspend failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
