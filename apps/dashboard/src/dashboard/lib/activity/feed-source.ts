/**
 * @fileType utility
 * @domain kody
 * @pattern activity-feed-source
 * @ai-summary Convex-backed reader for the Activity Feed. The engine streams
 *   events through /api/kody/events/ingest which persists them to the Convex
 *   chatEvents stream (per-session, tenant-scoped). The Feed asks Convex for
 *   the most-recently-active N sessions (chatEvents.recentSessions) and
 *   flattens each session's events (chatEvents.since) into EventLogEntry
 *   records. No GitHub reads on this path anymore — the 60s in-process list
 *   cache stays to keep the on-demand Feed tab cheap under repeat opens.
 */
import type { EventLogEntry } from "../kody-store/event-log";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "../backend/convex-backend";

const LIST_TTL_MS = 60_000;
/** Most-recent session streams merged into one feed. */
const MAX_SESSIONS = 12;

interface ListEntry {
  data: string[];
  expires: number;
}
const listCache = new Map<string, ListEntry>();
const listInflight = new Map<string, Promise<string[]>>();

/** Exported for unit tests — clears the session-list cache. */
export function _resetFeedSourceCache(): void {
  listCache.clear();
  listInflight.clear();
}

async function listRecentSessions(
  owner: string,
  repo: string,
): Promise<string[]> {
  const key = `${owner}/${repo}`;
  const cached = listCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  const existing = listInflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const sessions = (await getConvexClient().query(
        backendApi.chatEvents.recentSessions,
        {
          tenantId: tenantIdFor(owner, repo),
          limit: MAX_SESSIONS,
        },
      )) as string[];
      listCache.set(key, { data: sessions, expires: Date.now() + LIST_TTL_MS });
      return sessions;
    } catch (err: unknown) {
      if (cached) {
        // Errored: serve last good list, refresh TTL so we don't hammer the
        // backend on every subsequent open while degraded.
        listCache.set(key, {
          data: cached.data,
          expires: Date.now() + LIST_TTL_MS,
        });
        return cached.data;
      }
      throw err;
    } finally {
      listInflight.delete(key);
    }
  })();

  listInflight.set(key, promise);
  return promise;
}

interface RawLine {
  event?: string;
  payload?: Record<string, unknown>;
  runId?: string;
  emittedAt?: string;
  channel?: string;
  actionState?: EventLogEntry["actionState"];
}

/**
 * Read the connected repo's recent session event streams and flatten them
 * into `EventLogEntry`-shaped records for the pure feed fold.
 */
export async function readFeedEntries(
  owner: string,
  repo: string,
  _token: string,
): Promise<EventLogEntry[]> {
  const sessions = await listRecentSessions(owner, repo);
  const tenantId = tenantIdFor(owner, repo);

  const entries: EventLogEntry[] = [];
  await Promise.all(
    sessions.map(async (sid) => {
      let docs: Array<{ seq: number; event: unknown }>;
      try {
        docs = (await getConvexClient().query(backendApi.chatEvents.since, {
          tenantId,
          sessionId: sid,
          afterSeq: -1,
        })) as Array<{ seq: number; event: unknown }>;
      } catch {
        return; // one bad session stream shouldn't sink the whole feed
      }
      for (const doc of docs) {
        const o = doc.event as RawLine | null;
        if (!o || typeof o !== "object" || !o.event) continue;
        entries.push({
          id: `${sid}:${doc.seq}`,
          runId: o.runId ?? "unknown",
          event: o.event,
          payload: o.payload ?? {},
          channel: o.channel,
          actionState: o.actionState,
          emittedAt: o.emittedAt ?? new Date().toISOString(),
        });
      }
    }),
  );
  return entries;
}
