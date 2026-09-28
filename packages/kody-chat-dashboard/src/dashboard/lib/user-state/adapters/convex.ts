/**
 * @fileType utility
 * @domain user-state
 * @pattern user-state-adapter
 * @ai-summary Default Convex user-state adapter, backed by
 *   userState.{get,save} keyed by tenantId ("owner/repo"),
 *   namespace, and userKey. TTL cache in front of reads; writes invalidate.
 *   Convex writes are last-write-wins, so expectedRevision is advisory only.
 */
import "server-only";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { userFileKey } from "../user-key";
import type {
  UserStateAdapter,
  UserStateAdapterContext,
  UserStateDoc,
  UserStateNamespace,
} from "../types";

const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  doc: UserStateDoc | null;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

/** Exported for unit tests — clears the document cache. */
export function _resetUserStateDocCache(): void {
  cache.clear();
}

export function userStateFilePath(namespace: string, userId: string): string {
  return `user-state/${namespace}/${userFileKey(userId)}.json`;
}

function cacheKey(
  ctx: UserStateAdapterContext,
  namespace: string,
  userKey: string,
): string {
  return `user-state:${ctx.owner}/${ctx.repo}:${namespace}:${userKey}`;
}

interface UserStateBackendDoc {
  data: unknown;
  updatedAt: string;
}

export const convexUserStateAdapter: UserStateAdapter = {
  name: "convex",

  async get(ctx, userId, namespace: UserStateNamespace) {
    const userKey = userFileKey(userId);
    const key = cacheKey(ctx, namespace.name, userKey);
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.doc;
    }

    const record = (await createBackendClient().query(
      backendApi.userState.get,
      {
        tenantId: `${ctx.owner}/${ctx.repo}`,
        namespace: namespace.name,
        userKey,
      },
    )) as UserStateBackendDoc | null;

    const doc: UserStateDoc | null =
      record &&
      record.data &&
      typeof record.data === "object" &&
      !Array.isArray(record.data)
        ? {
            version: namespace.version,
            namespace: namespace.name,
            userId,
            updatedAt: record.updatedAt,
            data: record.data as Record<string, unknown>,
            revision: record.updatedAt ?? null,
          }
        : null;
    cache.set(key, { doc, expires: Date.now() + CACHE_TTL_MS });
    return doc;
  },

  async set(ctx, userId, namespace: UserStateNamespace, doc: UserStateDoc, opts) {
    const userKey = userFileKey(userId);
    cache.delete(cacheKey(ctx, namespace.name, userKey));

    await createBackendClient().mutation(backendApi.userState.save, {
      tenantId: `${ctx.owner}/${ctx.repo}`,
      namespace: namespace.name,
      userKey,
      data: doc.data,
      updatedAt: doc.updatedAt,
      // CAS token from the read this write was merged from; undefined keeps
      // legacy last-write-wins behaviour for callers without a prior read.
      ...(opts?.expectedRevision !== undefined
        ? { expectedUpdatedAt: opts.expectedRevision }
        : {}),
    });
  },
};
