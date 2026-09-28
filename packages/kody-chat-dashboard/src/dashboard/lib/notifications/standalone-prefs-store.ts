/**
 * @fileType utility
 * @domain kody
 * @pattern standalone-notification-prefs-store
 * @ai-summary Read/write per-user notification preferences as a JSON file on the
 *   configured Kody backend (`notifications/preferences/<login>.json`). One
 *   file per user → no cross-user write contention. Reads use ETag/If-None-Match
 *   so unchanged reads are a free 304. Writes use CAS (fetch SHA → write with
 *   SHA → retry on conflict).
 *
 *   This is the reusable backend JSON file-store helper. It generalizes to
 *   any key → `<dir>/<key>.json` path, with the backend ref and ETag caching
 *   built in.
 */
import "server-only";
import { getOwner, getRepo } from "../github-client";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

/** TTL for notification prefs cache. Low-churn data — 5 min is fine. */
const PREFS_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  expires: number;
  etag?: string;
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

function getCache<T>(key: string): { data: T; etag?: string } | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return { data: entry.data, etag: entry.etag };
}

function setCache<T>(key: string, data: T, etag?: string): void {
  cache.set(key, { data, expires: Date.now() + PREFS_CACHE_TTL_MS, etag });
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

/** The directory within the Kody backend where per-user prefs live. */
export const PREFS_DIR = "notifications/preferences";

function filePath(login: string): string {
  return `${PREFS_DIR}/${login.toLowerCase()}.json`;
}

/**
 * Read notification preferences for a user from the configured Kody backend.
 * Returns the cached data if still valid, otherwise fetches from GitHub
 * (using If-None-Match for a free 304 when unchanged).
 */
export async function readNotificationPrefs(
  login: string,
  _token?: string,
): Promise<NotificationPrefsFile> {
  const owner = getOwner();
  const repo = getRepo();
  const path = filePath(login);
  const key = cacheKey(owner, repo, login);

  const cached = getCache<NotificationPrefsFile>(key);
  try {
    const row = (await createBackendClient().query(api.notificationPrefs.get, {
      tenantId: `${owner}/${repo}`,
      login: login.toLowerCase(),
    })) as { prefs?: unknown } | null;
    const prefs = normalizePrefs(row?.prefs);
    setCache(key, prefs);
    return prefs;
  } catch (error: unknown) {
    // On any other error (network, rate limit, etc.), fail open with defaults.
    return cached?.data ?? DEFAULT_NOTIFICATION_PREFS;
  }
}

/**
 * Write notification preferences for a user to the configured Kody backend.
 * Uses CAS: fetches the current SHA, then writes with it. Retries once on
 * conflict (GitHub returns 409 when SHA doesn't match).
 */
export async function writeNotificationPrefs(
  login: string,
  prefsOrToken: NotificationPrefsFile | string,
  tokenOrPrefs?: string | NotificationPrefsFile,
): Promise<void> {
  const prefs =
    typeof prefsOrToken === "string"
      ? (tokenOrPrefs as NotificationPrefsFile)
      : prefsOrToken;
  const owner = getOwner();
  const repo = getRepo();
  const key = cacheKey(owner, repo, login);

  // Invalidate cache so the next read goes to GitHub
  cache.delete(key);

  await createBackendClient().mutation(api.notificationPrefs.save, {
    tenantId: `${owner}/${repo}`,
    login: login.toLowerCase(),
    prefs,
    updatedAt: new Date().toISOString(),
  });
}

function normalizePrefs(value: unknown): NotificationPrefsFile {
  const parsed = value as Partial<NotificationPrefsFile> | null;
  return {
    version: 1,
    mutedTypes: Array.isArray(parsed?.mutedTypes) ? parsed.mutedTypes : [],
  };
}
