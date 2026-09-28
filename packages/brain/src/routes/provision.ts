/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-fly-provision
 *
 * POST /api/kody/brain/provision
 *
 * Idempotent provision of the per-user Brain Fly app. Drives the
 * Settings "Repo Brain on Fly" toggle - the user flips it ON and we create
 * (or reuse) the app + machine. Returns the same shape as the chat
 * route's internal provisionServerBrain call.
 *
 * Auth and credentials come from the personal Brain host boundary. No
 * repository is required.
 *
 * App name resolution (in order):
 *   1. `appName` in the request body — explicit user override from the
 *      Runner card's "Fly app name" field.
 *   2. The `appName` in the storage record (`users/<login>/data/
 *      brain.json`) — what we used last time, so the chat route and
 *      the Runner stay in sync.
 *   3. The derived `kody-brain-<github-login>` name.
 *
 * On success, the storage record is updated to reflect the actual
 * name (and the org Fly reports). On failure, Fly's message surfaces
 * verbatim — no swallowing, no retry.
 *
 * The chat route /api/kody/chat/brain-fly still calls provisionServerBrain
 * directly as a safety net (idempotent), so this route is purely for
 * the user-initiated path from Settings.
 */

import { NextRequest, NextResponse } from "next/server";

import { BrainCommandError, manageBrainServer } from "../server-commands";
import { logger } from "@kody-ade/base/logger";
import type { ServerBrainPerfTier } from "@kody-ade/fly/infrastructure/server-brain";
import { resolvePersonalBrainContext } from "../personal-context";
import { requestOrigin } from "@kody-ade/base/request-origin";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Brain has its OWN size, set independently of the per-user task-run speed
 * (`x-kody-fly-perf`). The `x-kody-brain-perf` header carries it; absent →
 * fall back to the shared tier, then the server default. */
function brainPerfFrom(
  req: NextRequest,
  fallback?: ServerBrainPerfTier,
): ServerBrainPerfTier | undefined {
  const raw = req.headers.get("x-kody-brain-perf");
  return raw === "low" || raw === "medium" || raw === "high" ? raw : fallback;
}

function brainSuspendOnIdleFrom(req: NextRequest): boolean | undefined {
  const raw = req.headers.get("x-kody-brain-suspension");
  if (raw === "never") return false;
  if (raw === "auto") return true;
  return undefined;
}

/** Parse and validate the optional `appName` from the request body. */
function parseAppNameOverride(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const v = (body as { appName?: unknown }).appName;
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  // Fly app names must match ^[a-z0-9][a-z0-9-]*$ and be ≤ 30 chars.
  if (trimmed.length === 0) return undefined;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) return undefined;
  if (trimmed.length > 30) return undefined;
  return trimmed;
}

export async function POST(req: NextRequest) {
  const ctx = await resolvePersonalBrainContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ctx.context.flyToken) {
    return NextResponse.json(
      {
        error:
          "Brain needs a Fly token. Add FLY_API_TOKEN to Personal Credentials.",
      },
      { status: 400 },
    );
  }

  try {
    // Parse the optional explicit override from the UI.
    const body = (await req.json().catch(() => ({}))) as unknown;
    const override = parseAppNameOverride(body);

    const result = await manageBrainServer({
      command: "provision",
      context: ctx.context,
      perfTier: brainPerfFrom(req, ctx.context.perfTier),
      suspendOnIdle: brainSuspendOnIdleFrom(req),
      dashboardUrl: requestOrigin(req),
      appNameOverride: override,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId: ctx.context.userId }, "brain provision failed");
    if (
      err instanceof BrainCommandError &&
      err.code === "brain_provision_retryable"
    ) {
      return NextResponse.json(
        { error: message, retryable: true },
        {
          status: 503,
          headers: { "Retry-After": String(err.retryAfterSeconds ?? 30) },
        },
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
