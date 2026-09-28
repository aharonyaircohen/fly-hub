/**
 * @fileType utility
 * @domain events
 * @pattern system-event-emitter
 * @ai-summary `emitSystemEvent(name, payload, ctx)` — the single emit path
 *   for the system-event backbone. Validates the payload against the
 *   hardcoded catalog (invalid → warn + drop, never throw), wraps it in the
 *   standard envelope, and fans out to registered sinks via the injected
 *   flush scheduler (the app installs Next's `after()` at startup via
 *   `setEventFlushScheduler`) so emitting never blocks or fails the
 *   observed action.
 */
import "server-only";
import type { Octokit } from "@octokit/rest";
import { logger } from "@kody-ade/base/logger";
import {
  SYSTEM_EVENT_CATALOG,
  type SystemEventName,
  type SystemEventPayload,
} from "./catalog";
import { dispatchToSinks, registerSystemEventSink } from "./sink-registry";
import { durableLogSink } from "./sinks/log-sink";
import { pinoSink } from "./sinks/pino-sink";
import { triggerSink } from "../triggers/sink";
import type {
  SystemEventBrand,
  SystemEventEnvelope,
  SystemEventSource,
} from "./types";

export interface EmitContext {
  userId?: string | null;
  sessionId?: string | null;
  brand?: SystemEventBrand | null;
  source: SystemEventSource;
  /** Brand-authenticated octokit for the durable sink, when available. */
  octokit?: Octokit | null;
}

/**
 * Schedules the sink fan-out task. Framework-free default runs the task on
 * the microtask queue; a Next.js host should install `after()` from
 * "next/server" once at startup via `setEventFlushScheduler(after)` so
 * dispatch happens after the response is sent.
 */
export type EventFlushScheduler = (task: () => void | Promise<void>) => void;

const defaultScheduler: EventFlushScheduler = (task) => {
  queueMicrotask(() => {
    void Promise.resolve()
      .then(task)
      .catch(() => {});
  });
};

// globalThis-backed: Next bundles this TS-source package separately per
// server entry (instrumentation vs. routes), so a module-level variable
// set at startup is invisible to other bundles.
const SCHEDULER_KEY = Symbol.for("kody.events.flushScheduler");

type SchedulerGlobal = { [SCHEDULER_KEY]?: EventFlushScheduler };

/** Install a host-specific flush scheduler (e.g. Next's `after`). */
export function setEventFlushScheduler(fn: EventFlushScheduler): void {
  (globalThis as SchedulerGlobal)[SCHEDULER_KEY] = fn;
}

function getFlushScheduler(): EventFlushScheduler {
  return (globalThis as SchedulerGlobal)[SCHEDULER_KEY] ?? defaultScheduler;
}

let defaultSinksRegistered = false;

function ensureDefaultSinks(): void {
  if (defaultSinksRegistered) return;
  defaultSinksRegistered = true;
  registerSystemEventSink(pinoSink);
  registerSystemEventSink(durableLogSink);
  // Trigger rules react to events; the sink no-ops until the host installs
  // a state writer via setTriggerStateWriter().
  registerSystemEventSink(triggerSink);
}

/** Exported for unit tests — allows re-registering default sinks. */
export function _resetDefaultSinkRegistration(): void {
  defaultSinksRegistered = false;
}

function newEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Emit a system event. Fire-and-forget: returns immediately, never throws,
 * never blocks or fails the action being observed.
 */
export function emitSystemEvent<N extends SystemEventName>(
  name: N,
  payload: SystemEventPayload<N>,
  ctx: EmitContext,
): void {
  const definition = SYSTEM_EVENT_CATALOG[name];
  const parsed = definition.schema.safeParse(payload);
  if (!parsed.success) {
    logger.warn(
      { event: name, issues: parsed.error.issues },
      "emitSystemEvent: invalid payload dropped",
    );
    return;
  }

  const envelope: SystemEventEnvelope = {
    id: newEventId(),
    name,
    version: definition.version,
    occurredAt: new Date().toISOString(),
    userId: ctx.userId ?? null,
    sessionId: ctx.sessionId ?? null,
    brand: ctx.brand ?? null,
    source: ctx.source,
    payload: parsed.data,
  };

  ensureDefaultSinks();
  const work = () =>
    dispatchToSinks([envelope], { octokit: ctx.octokit ?? null });

  try {
    getFlushScheduler()(work);
  } catch {
    // Scheduler unavailable (e.g. Next's `after()` outside a request scope)
    // — dispatch directly so nothing is silently dropped.
    void work().catch(() => {});
  }
}
