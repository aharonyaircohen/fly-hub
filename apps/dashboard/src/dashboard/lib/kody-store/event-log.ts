/**
 * @fileOverview Kody Event Log Store — Convex-backed
 * @fileType store
 * @domain kody
 *
 * Append-only event log stored in the global (cross-tenant) Convex
 * `eventLog` table via eventLog.{append,forRun,recent}. The backend caps
 * the table at 10k entries (trim-on-append, oldest first) — same policy as
 * the old `event-log.jsonl` in the Kody backend, which this replaces.
 *
 * The `opts` bags (owner/repo/branch/octokit) are retained for signature
 * compatibility with the backend era; Convex ignores them.
 */

import type { Octokit } from "@octokit/rest";
import { backendApi, getConvexClient } from "../backend/convex-backend";

export interface EventLogEntry {
  id: string;
  runId: string;
  event: string;
  payload: Record<string, unknown>;
  channel?: string;
  actionState?: { status: string; step: string; sessionId?: string };
  emittedAt: string;
}

/** Legacy opts bag — unused by the Convex store, kept so callers compile. */
export interface EventLogOpts {
  owner?: string;
  repo?: string;
  branch?: string;
  octokit?: Octokit | null;
}

interface EventLogDoc {
  entryId: string;
  runId: string;
  event: string;
  payload: Record<string, unknown>;
  channel?: string;
  emittedAt: string;
}

/** `recent` is server-capped at 1000; the log itself is capped at 10k. */
const RECENT_LIMIT = 1000;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function entryFromDoc(doc: EventLogDoc): EventLogEntry {
  return {
    id: doc.entryId,
    runId: doc.runId,
    event: doc.event,
    payload: doc.payload,
    ...(doc.channel !== undefined ? { channel: doc.channel } : {}),
    emittedAt: doc.emittedAt,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Append an event entry to the log. */
export async function logEvent(
  event: string,
  payload: Record<string, unknown>,
  actionState?: EventLogEntry["actionState"],
  channel = "pipeline",
  _opts: EventLogOpts = {},
): Promise<EventLogEntry> {
  const entry: EventLogEntry = {
    id: generateId(),
    runId: (payload.runId as string) ?? "unknown",
    event,
    payload,
    actionState,
    channel,
    emittedAt: new Date().toISOString(),
  };

  await getConvexClient().mutation(backendApi.eventLog.append, {
    entryId: entry.id,
    runId: entry.runId,
    event: entry.event,
    payload: entry.payload,
    channel: entry.channel,
    emittedAt: entry.emittedAt,
  });
  return entry;
}

/** Get all events for a runId. */
export async function getEventHistory(
  runId: string,
  _opts: EventLogOpts = {},
): Promise<EventLogEntry[]> {
  const docs = (await getConvexClient().query(backendApi.eventLog.forRun, {
    runId,
  })) as EventLogDoc[];
  return docs.map(entryFromDoc);
}

/** Get recent events (no run filter). Newest-first, capped at 1000. */
export async function getAllEvents(
  _opts: EventLogOpts = {},
): Promise<EventLogEntry[]> {
  const docs = (await getConvexClient().query(backendApi.eventLog.recent, {
    limit: RECENT_LIMIT,
  })) as EventLogDoc[];
  return docs.map(entryFromDoc);
}

/** Get the most recent event for a runId. */
export async function getLastEvent(
  runId: string,
  _opts: EventLogOpts = {},
): Promise<EventLogEntry | null> {
  const history = await getEventHistory(runId, _opts);
  return history.at(-1) ?? null;
}
