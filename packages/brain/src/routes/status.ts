/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-status
 *
 * GET /api/kody/brain/status
 *
 * Read-only state of the per-user Brain Fly app for the connected repo.
 * Drives the BrainFlyStatusBar pill in the chat panel and the Runner page.
 *
 * Returns:
 *   { state: 'off' }                                    — no Fly token, no app yet.
 *   { state: 'running'|'suspended'|'stopped',
 *     app, url, machineId?, stored? }                   — live machine state.
 *
 * `stored` is the per-user record at
 * backend root `users/<login>/data/brain.json` (see `brain/store.ts`). It can
 * outlive the user's access to the app on Fly (token revoked, app moved
 * orgs, slug taken by another account) — in that case `state` is `off`
 * and `stored` is non-null, which the Runner page surfaces as an orphan
 * with a "Delete record" affordance.
 *
 * Provision lives in the chat route (POST /api/kody/chat/brain-fly) — the
 * first message provisions and resumes. This endpoint never mutates Fly.
 */

import { NextRequest, NextResponse } from "next/server";

import { readBrainOverview } from "../overview";
import { logger } from "@kody-ade/base/logger";
import { resolvePersonalBrainContext } from "../personal-context";

export const runtime = "nodejs";
const STATUS_READ_TIMEOUT_MS = 15_000;

export async function GET(req: NextRequest) {
  const ctx = await resolvePersonalBrainContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  if (!ctx.context.flyToken) {
    return NextResponse.json({
      state: "off",
      reason: "fly_token_missing",
      stored: null,
      machines: [],
    });
  }

  try {
    const overview = await Promise.race([
      readBrainOverview({
        flyToken: ctx.context.flyToken,
        account: ctx.context.account,
        githubToken: ctx.context.githubToken,
        orgSlug: ctx.context.flyOrgSlug,
        defaultRegion: ctx.context.flyDefaultRegion,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new BrainStatusTimeoutError()),
          STATUS_READ_TIMEOUT_MS,
        ),
      ),
    ]);
    if (!overview.service) {
      return NextResponse.json({
        state: "off",
        stored: overview.stored,
        runtime: overview.runtime,
        drift: overview.drift,
        machines: [],
      });
    }
    return NextResponse.json({
      app: overview.app,
      state: overview.state,
      url: overview.url,
      machineId: overview.machineId,
      machineImageRef: overview.machineImageRef,
      org: overview.org,
      reason: overview.reason,
      stored: overview.stored,
      runtime: overview.runtime,
      drift: overview.drift,
      machines: overview.service.machine ? [overview.service.machine] : [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId: ctx.context.userId }, "brain status failed");
    if (err instanceof BrainStatusTimeoutError) {
      return NextResponse.json(
        { error: "brain_status_timeout", retryable: true },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

class BrainStatusTimeoutError extends Error {
  constructor() {
    super("Brain status read timed out");
    this.name = "BrainStatusTimeoutError";
  }
}
