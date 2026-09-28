/**
 * @fileType utility
 * @domain kody
 * @pattern notification-prefs-store
 * @ai-summary Read/write per-user notification preferences in the Convex
 *   backend (notificationPrefs.{get,save}, keyed by lowercase login, tenant
 *   scoped by owner/repo). Short TTL cache in front of reads; writes
 *   invalidate.
 */
import "server-only";
import { getOwner, getRepo } from "../github-client";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "../backend/convex-backend";

/** TTL for notification prefs cache. Low-churn data — 5 min is fine. */
const PREFS_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Exported for unit tests — clears all prefs cache entries. */
export function _resetPrefsCache(): void {
  for (const key of cache.keys()) {
    if (key.startsWith("notif-prefs:")) {
      cache.delete(key);
    }
  }
}

function getCache<T>(key: string): { data: T } | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return { data: entry.data };
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expires: Date.now() + PREFS_CACHE_TTL_MS });
}

function cacheKey(owner: string, repo: string, login: string): string {
  return `notif-prefs:${owner}:${repo}:${login.toLowerCase()}`;
}

/**
 * Server-known notification types that can be individually muted.
 * Subset of NotificationType that can be enforced server-side (i.e., those
 * produced by the mention/inbox webhook spine).
 */
export type ServerNotificationType =
  | "task-assigned"
  | "task-completed"
  | "task-failed"
  | "pr-ready"
  | "pr-merged"
  | "chat-response"
  | "gate-waiting";

/** Persisted notification preferences shape. */
export interface NotificationPrefsFile {
  version: 1;
  mutedTypes: ServerNotificationType[];
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefsFile = {
  version: 1,
  mutedTypes: [],
};

/** Legacy backend directory — kept for the backend export route only. */
export const PREFS_DIR = "notifications/preferences";

function normalizePrefs(value: unknown): NotificationPrefsFile {
  const parsed = value as Partial<NotificationPrefsFile> | null;
  return {
    version: 1,
    mutedTypes: Array.isArray(parsed?.mutedTypes) ? parsed.mutedTypes : [],
  };
}

/**
 * Read notification preferences for a user. Returns cached data when still
 * valid; falls back to defaults on missing doc or backend error (prefs are
 * best-effort).
 */
export async function readNotificationPrefs(
  login: string,
): Promise<NotificationPrefsFile> {
  const owner = getOwner();
  const repo = getRepo();
  const key = cacheKey(owner, repo, login);

  const cached = getCache<NotificationPrefsFile>(key);
  if (cached) return cached.data;

  try {
    const doc = (await getConvexClient().query(
      backendApi.notificationPrefs.get,
      { tenantId: tenantIdFor(owner, repo), login: login.toLowerCase() },
    )) as { prefs: unknown } | null;
    const prefs = doc ? normalizePrefs(doc.prefs) : DEFAULT_NOTIFICATION_PREFS;
    setCache(key, prefs);
    return prefs;
  } catch {
    // On any error (network, backend outage), fail open with defaults.
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

/** Write notification preferences for a user to the Convex backend. */
export async function writeNotificationPrefs(
  login: string,
  prefs: NotificationPrefsFile,
): Promise<void> {
  const owner = getOwner();
  const repo = getRepo();
  cache.delete(cacheKey(owner, repo, login));

  await getConvexClient().mutation(backendApi.notificationPrefs.save, {
    tenantId: tenantIdFor(owner, repo),
    login: login.toLowerCase(),
    prefs,
    updatedAt: new Date().toISOString(),
  });
}
