/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-stored-record
 *
 * GET /api/kody/brain/stored   — read the user's stored brain record.
 * DELETE /api/kody/brain/stored — clear the stored record (orphan recovery).
 *
 * The stored record at backend root `users/<login>/data/brain.json` is the
 * dashboard's record of "here is the Fly app we believe this user has."
 * It can outlive the user's access to the app on Fly (token revoked, app
 * moved to a different org, slug taken by another account, etc.), in
 * which case the Runner page shows it as an "orphan" and the user can
 * DELETE this record to clear it before re-provisioning.
 *
 * DELETE is a metadata-only operation — it does NOT touch Fly. Use
 * POST /api/kody/brain/destroy for the actual Fly teardown.
 */

import { NextRequest, NextResponse } from "next/server";

import { clearBrainApp, readBrainApp, type BrainAppFile } from "../store";
import { logger } from "@kody-ade/base/logger";
import { resolvePersonalBrainContext } from "../personal-context";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = await resolvePersonalBrainContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  // The storage layer reads owner/repo from the request-scoped github
  // context (`getOwner()` / `getRepo()`), not from the fly context we
  // just resolved. Set it explicitly so the read targets the right repo.
  try {
    const record = await readBrainApp(
      ctx.context.account,
      ctx.context.githubToken,
    );
    return NextResponse.json({ stored: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, userId: ctx.context.userId },
      "brain stored: read failed",
    );
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await resolvePersonalBrainContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  try {
    await clearBrainApp(ctx.context.account, ctx.context.githubToken);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, userId: ctx.context.userId },
      "brain stored: clear failed",
    );
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export type { BrainAppFile };
