/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-resume
 *
 * POST /api/kody/brain/resume
 *
 * Wake a suspended/stopped Brain machine. Idempotent — returns 200 when
 * already running or when no machine exists. Pairs with /api/kody/brain/suspend
 * for the user-initiated pause/resume toggle in Settings.
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
      await manageBrainServer({ command: "resume", context: ctx.context }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId: ctx.context.userId }, "brain resume failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
