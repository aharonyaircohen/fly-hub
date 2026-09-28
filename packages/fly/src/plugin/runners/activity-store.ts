/**
 * @fileType utility
 * @domain runner
 * @pattern fly-activity-store
 * @ai-summary Persists Fly activity snapshots on the Convex backend
 *   (dailyLogs, stream "flyActivity" — one row per snapshot). Replaces the
 *   old `state/fly-activity.json` GitHub backend file, which silently
 *   broke once it crossed GitHub's 1 MB contents-API limit (reads returned
 *   null → empty timeline, writes 422'd). Reads take the most recent rows
 *   and window them to 14 days; writes are throttled (≥5 min interval).
 *
 * The `octokit`/`owner`/`repo` signature is kept so callers (activity route,
 * preview webhook, provider plugin interface) are untouched; the octokit is
 * no longer used for storage.
 */
import "server-only";

import type { Octokit } from "@octokit/rest";

import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "@kody-ade/base/backend/convex";
import {
  EMPTY_ACTIVITY_FILE,
  type ActivitySample,
  type ActivitySnapshot,
  type FlyActivityFile,
} from "./activity";
import type { FlyInventory } from "./inventory";

const STREAM = "flyActivity";

/** Don't record more often than this — a snapshot per page view would spam. */
const MIN_INTERVAL_MS = 5 * 60_000;
/** Keep ~14 days of history. */
const WINDOW_MS = 14 * 24 * 60 * 60_000;
/** Most recent rows fetched per read (14d at the 5-min throttle ≈ 4032 max;
 * in practice snapshots only land on page views / webhooks, so far fewer). */
const READ_LIMIT = 1000;

interface DailyLogRow {
  entry?: unknown;
}

function coerceSnapshot(entry: unknown): ActivitySnapshot | null {
  if (!entry || typeof entry !== "object") return null;
  const snap = entry as Partial<ActivitySnapshot>;
  if (typeof snap.ts !== "number" || !Array.isArray(snap.machines)) {
    return null;
  }
  return { ts: snap.ts, machines: snap.machines };
}

/** Whether enough time has passed since the last snapshot to record another.
 * Exported so callers (e.g. the webhook) can skip an expensive Fly inventory
 * call when a write would be throttled anyway. */
export function snapshotDue(file: FlyActivityFile, now: number): boolean {
  const last = file.snapshots[file.snapshots.length - 1];
  return !last || now - last.ts >= MIN_INTERVAL_MS;
}

/** Read the activity timeline (used by the API route): most recent snapshots,
 * windowed to 14 days, oldest-first (the order computeActivity expects). */
export async function readActivityFile(
  /** Unused by the Convex-backed store — kept for the shared adapter contract. */
  _octokit: Octokit,
  owner: string,
  repo: string,
): Promise<FlyActivityFile> {
  const rows = (await getConvexClient().query(backendApi.dailyLogs.recent, {
    tenantId: tenantIdFor(owner, repo),
    stream: STREAM,
    limit: READ_LIMIT,
  })) as DailyLogRow[];
  const cutoff = Date.now() - WINDOW_MS;
  const snapshots = rows
    .map((row) => coerceSnapshot(row.entry))
    .filter((snap): snap is ActivitySnapshot => snap !== null)
    .filter((snap) => snap.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts);
  if (snapshots.length === 0) return structuredClone(EMPTY_ACTIVITY_FILE);
  return { version: 1, snapshots };
}

/** Map a live inventory into a storable snapshot — keep only the fields the
 * activity compute needs (drops region/labels, which it re-derives). */
export function snapshotFromInventory(
  inv: FlyInventory,
  now: number,
): ActivitySnapshot {
  const machines: ActivitySample[] = inv.machines.map((m) => ({
    app: m.app,
    machineId: m.machineId,
    state: m.state,
    cpuKind: m.guest?.cpuKind,
    cpus: m.guest?.cpus,
    memoryMb: m.guest?.memoryMb,
  }));
  return { ts: now, machines };
}

/** UTC YYYY-MM-DD for a ms timestamp — the dailyLogs partition key. */
function dateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Append `snapshot` to the timeline (throttled). Returns whether a write
 * actually happened (false = throttled because the last snapshot is recent).
 * Best-effort: callers treat a thrown error as non-fatal. Old rows age out
 * of the read window instead of being pruned at write time.
 */
export async function recordSnapshot(
  /** Unused by the Convex-backed store — kept for the shared adapter contract. */
  _octokit: Octokit,
  owner: string,
  repo: string,
  snapshot: ActivitySnapshot,
): Promise<{ recorded: boolean }> {
  const client = getConvexClient();
  const tenantId = tenantIdFor(owner, repo);
  const rows = (await client.query(backendApi.dailyLogs.recent, {
    tenantId,
    stream: STREAM,
    limit: 1,
  })) as DailyLogRow[];
  const last = coerceSnapshot(rows[0]?.entry);
  if (last && snapshot.ts - last.ts < MIN_INTERVAL_MS) {
    return { recorded: false };
  }
  await client.mutation(backendApi.dailyLogs.append, {
    tenantId,
    stream: STREAM,
    date: dateKey(snapshot.ts),
    entry: snapshot,
  });
  return { recorded: true };
}
