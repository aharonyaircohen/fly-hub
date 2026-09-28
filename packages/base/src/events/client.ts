/**
 * @fileType utility
 * @domain events
 * @pattern system-event-client-bridge
 * @ai-summary Browser-side system-event tracker. Validates event names and
 *   payloads against the catalog, queues events, and flushes small batches
 *   to `POST /api/kody/system-events` with `keepalive` so events survive
 *   navigation. Best-effort and silent on failure — tracking must never
 *   break the UI. Identity is resolved server-side; nothing here is trusted.
 */
"use client";

import {
  buildKodyAuthHeaders,
  type KodyAuthHeaderContext,
} from "@kody-ade/base/auth-headers";
import {
  SYSTEM_EVENT_CATALOG,
  isSystemEventName,
  type SystemEventName,
  type SystemEventPayload,
} from "./catalog";

const ENDPOINT = "/api/kody/system-events";
const FLUSH_DELAY_MS = 2000;
const MAX_BATCH = 20;

interface QueuedEvent {
  name: SystemEventName;
  payload: Record<string, unknown>;
  sessionId?: string;
  occurredAt: string;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function readStoredAuth(): KodyAuthHeaderContext | null {
  try {
    const raw = window.localStorage.getItem("kody_auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KodyAuthHeaderContext;
    return parsed && parsed.token && parsed.owner && parsed.repo
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function flush(): void {
  if (queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      keepalive: true,
      headers: {
        "content-type": "application/json",
        ...buildKodyAuthHeaders(readStoredAuth()),
      },
      body: JSON.stringify({ events: batch }),
    }).catch(() => {});
  } catch {
    // Tracking is best-effort; never surface errors to the UI.
  }
  if (queue.length > 0) scheduleFlush(0);
}

function scheduleFlush(delayMs: number = FLUSH_DELAY_MS): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, delayMs);
}

/**
 * Track a system event from the browser. Invalid names/payloads are dropped
 * client-side; identity and brand are resolved server-side.
 */
export function trackSystemEvent<N extends SystemEventName>(
  name: N,
  payload: SystemEventPayload<N>,
  opts: { sessionId?: string } = {},
): void {
  if (typeof window === "undefined") return;
  if (!isSystemEventName(name)) return;
  const parsed = SYSTEM_EVENT_CATALOG[name].schema.safeParse(payload);
  if (!parsed.success) return;
  queue = [
    ...queue,
    {
      name,
      payload: parsed.data,
      sessionId: opts.sessionId,
      occurredAt: new Date().toISOString(),
    },
  ];
  scheduleFlush();
}

const BROWSER_SESSION_KEY = "kody-system-events-session";

/**
 * Emit `session.started` once per browser session (sessionStorage-scoped).
 * Returns the browser session id.
 */
export function startBrowserSession(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.sessionStorage.getItem(BROWSER_SESSION_KEY);
    if (existing) return existing;
    const id = `bs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(BROWSER_SESSION_KEY, id);
    trackSystemEvent("session.started", { sessionId: id });
    return id;
  } catch {
    return null;
  }
}
