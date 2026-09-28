/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-destroy
 *
 * POST /api/kody/brain/destroy
 *
 * Tear down the per-user Brain Fly app + all machines under it. Idempotent —
 * returns 200 even if nothing exists. On success, also clears the per-user
 * brain record at backend root `users/<login>/data/brain.json` so the Runner page
 * stops showing the destroyed app.
 *
 * If Fly is unreachable (e.g. the token's org no longer matches the app's
 * org), the storage record is preserved — the user needs the separate
 * "Delete record" affordance to wipe it. This route surfaces the Fly error
 * in that case so the user knows the Fly app may still exist somewhere.
 *
 * Lives separately from the chat route so the BrainFlyStatusBar can offer
 * an explicit off switch. The next chat message will re-provision from
 * scratch.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { manageBrainServer } from "../server-commands";
import { logger } from "@kody-ade/base/logger";
import { resolvePersonalBrainContext } from "../personal-context";

export const runtime = "nodejs";

const DestroyBrainBody = z.object({
  appName: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  actorLogin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown = {};
  const rawBody = await req.text();
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
  }
  const parsed = DestroyBrainBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

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
      await manageBrainServer({
        command: "destroy",
        context: ctx.context,
        ...(parsed.data.appName
          ? { appNameOverride: parsed.data.appName }
          : {}),
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId: ctx.context.userId }, "brain destroy failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
