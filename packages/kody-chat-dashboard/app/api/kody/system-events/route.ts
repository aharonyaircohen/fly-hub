/**
 * @fileType api-route
 * @domain events
 * @pattern system-event-bridge
 * @ai-summary Client→server bridge for the system-event backbone. Accepts a
 *   small batch of catalog events from the browser, resolves the actor
 *   server-side (client-claimed identity is never trusted), and emits each
 *   through `emitSystemEvent` with `source: "client"`.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUserOctokit } from "@kody-ade/base/github/core";
import { resolveUnifiedActor } from "../../../../src/dashboard/lib/auth/unified-actor";
import { ensureTriggerStateWriter } from "../../../../src/dashboard/lib/user-state";
import { emitSystemEvent, isSystemEventName } from "@kody-ade/base/events";
import type { SystemEventPayload, SystemEventName } from "@kody-ade/base/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Only browser-semantics events may enter through this bridge. Server
 * events (state.entity.written, chat.response.completed, system.error,
 * auth.*) are emitted by the server code that owns them — accepting them
 * here would let any authenticated client forge them into the log.
 */
const CLIENT_EMITTABLE_EVENTS = new Set<string>([
  "session.started",
  "session.ended",
  "page.viewed",
  "ui.view.shown",
  "ui.form.submitted",
  "ui.action.clicked",
]);

/** Fixed-window in-memory rate limit per actor: 120 events / minute. */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_EVENTS = 120;
const rateWindows = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(actorId: string, eventCount: number): boolean {
  const now = Date.now();
  const window = rateWindows.get(actorId);
  if (!window || window.resetAt <= now) {
    rateWindows.set(actorId, {
      count: eventCount,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }
  window.count += eventCount;
  return window.count > RATE_LIMIT_MAX_EVENTS;
}

const bodySchema = z
  .object({
    events: z
      .array(
        z
          .object({
            name: z.string().trim().min(1),
            payload: z.record(z.string(), z.unknown()).default({}),
            sessionId: z.string().trim().min(1).optional(),
            occurredAt: z.string().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Trigger execution must not depend on host instrumentation having run
  // in this process — install the writer idempotently per request bundle.
  ensureTriggerStateWriter();
  const actor = await resolveUnifiedActor(req);
  if (!actor) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ message: "Invalid body" }, { status: 400 });
  }

  const rejected = body.events.find(
    (event) =>
      !isSystemEventName(event.name) ||
      !CLIENT_EMITTABLE_EVENTS.has(event.name),
  );
  if (rejected) {
    return NextResponse.json(
      { message: `Event not accepted from the client: ${rejected.name}` },
      { status: 400 },
    );
  }

  if (isRateLimited(actor.userId, body.events.length)) {
    return NextResponse.json({ message: "Rate limited" }, { status: 429 });
  }

  for (const event of body.events) {
    emitSystemEvent(
      event.name as SystemEventName,
      event.payload as SystemEventPayload<SystemEventName>,
      {
        userId: actor.userId,
        sessionId: event.sessionId ?? null,
        brand: actor.brand,
        source: "client",
        // Operator requests carry a PAT — hand its octokit to the sinks so
        // triggers/durable-log work even when no app/vault background token
        // is configured (the common dev setup).
        octokit: actor.token ? createUserOctokit(actor.token) : null,
      },
    );
  }

  return new NextResponse(null, { status: 204 });
}
