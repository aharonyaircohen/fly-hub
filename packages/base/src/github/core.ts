/**
 * @fileType utility
 * @domain kody
 * @pattern github-client
 * @ai-summary GitHub client core: per-request context, Octokit construction, in-process cache + ETag machinery, targeted invalidation. No feature imports.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import { GITHUB_OWNER, GITHUB_REPO } from "../constants";
// ============ Types ============

interface CacheEntry<T> {
  data: T;
  expires: number;
  etag?: string; // ETag from GitHub for conditional requests
  lastModified?: string; // Last-Modified header
}

// ============ Cache ============

export const cache = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) {
    return entry.data as T;
  }
  // Keep expired entries so their ETag survives for conditional GETs.
  // The next setCache (or invalidateCache) will overwrite / evict them.
  return null;
}

/**
 * Return a stale (expired) cache entry + its ETag, for use with
 * `If-None-Match` conditional GitHub requests. Returning 304 (free — does
 * not count against the rate limit) lets us refresh the TTL on the existing
 * data without re-downloading it.
 */
export function getStale<T>(key: string): { data: T; etag?: string } | null {
  const entry = cache.get(key);
  return entry ? { data: entry.data as T, etag: entry.etag } : null;
}

/**
 * Get cached data along with its ETag for conditional requests
 */
export function setCache<T>(
  key: string,
  ttl: number,
  data: T,
  options?: { etag?: string; lastModified?: string },
): void {
  cache.set(key, {
    data,
    expires: Date.now() + ttl,
    etag: options?.etag,
    lastModified: options?.lastModified,
  });
}

/**
 * Invalidate specific cache keys by prefix
 * More targeted than clearing the entire cache
 */
export function invalidateCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Cross-instance invalidation via Next's Data Cache. Local instance already
 * cleared its in-process Map above; this fans the same signal out to every
 * other serverless instance so they don't keep serving stale data until TTL.
 *
 * Safe today: unknown tags are no-ops in Next. As reads migrate to
 * `fetch(..., { next: { tags: ['gh:<tag>'] } })`, they automatically pick
 * up cross-instance invalidation without touching this function again.
 *
 * Swallows errors — invalidation is best-effort; we never want a stale-data
 * fix to throw and break the write that triggered it.
 */
function revalidateTagSafe(tag: string): void {
  try {
    // Lazy require keeps `next/cache` out of client bundles when
    // github-client.ts is transitively imported by a client component
    // (e.g. ModelsManager → variables/models → get-variable → here).
    // Server-side this is a normal sync require; the client never reaches
    // these write paths so the function is effectively a no-op there.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { revalidateTag } =
      require("next/cache") as typeof import("next/cache");
    /* eslint-enable @typescript-eslint/no-require-imports */
    revalidateTag(tag, { expire: 0 });
  } catch {
    // Outside a request scope (e.g. tests, scripts) revalidateTag throws.
    // The in-process Map invalidation above is the authoritative path here.
  }
}

/**
 * Targeted cache invalidation by category
 * Instead of clearing everything, only clear relevant caches
 */
export function invalidateTaskCache(): void {
  invalidateCache("issues:");
  invalidateCache("issue:");
  invalidateCache("workflows:");
  revalidateTagSafe("gh:issues");
  revalidateTagSafe("gh:workflows");
}

export function invalidatePRCache(): void {
  invalidateCache("pr:");
  invalidateCache("pr-");
  invalidateCache("open-prs:");
  invalidateCache("previews:");
  revalidateTagSafe("gh:prs");
}

export function invalidateBoardCache(): void {
  invalidateCache("boards:");
  invalidateCache("labels:");
  invalidateCache("milestones:");
  revalidateTagSafe("gh:boards");
}

export function invalidateBranchCache(): void {
  invalidateCache("branch:");
  invalidateCache("branches:");
  invalidateCache("refs:");
  revalidateTagSafe("gh:branches");
}

/**
 * Wipe the per-PR "behind base" cache. Called on any push/PR webhook so the
 * next read sees fresh `behind_by` without waiting for TTL — a push to the
 * base branch leaves every open PR potentially out of date.
 */
export function invalidatePRBehindCache(): void {
  invalidateCache("prbehind:");
  revalidateTagSafe("gh:prbehind");
}

/**
 * Invalidate cache entries for a single issue plus every cached issues listing.
 * Use after a write that mutates an issue (or a manifest stored in an issue),
 * so the next read on this serverless instance picks up the change without
 * waiting for the TTL.
 */
export function invalidateIssueCache(issueNumber?: number): void {
  if (typeof issueNumber === "number") {
    // Cache keys are repo-scoped (`issue:owner:repo:N`, `comments:owner:repo:N`).
    // Webhooks don't carry repo context, so wipe across all repos via prefix.
    invalidateCache("issue:");
    invalidateCache("comments:");
    // PRs are issues in the GitHub API — `issue_comment` events fire for PR
    // conversation comments too. The PreviewModal comment list reads from
    // `pr-comments:` (separate prefix from `comments:`), so clear that too.
    invalidateCache("pr-comments:");
    revalidateTagSafe(`gh:issue:${issueNumber}`);
    revalidateTagSafe(`gh:comments:${issueNumber}`);
  }
  invalidateCache("issues:");
  revalidateTagSafe("gh:issues");
}

/**
 * Invalidate cache entries for capability folders. Pass a slug to scope to one
 * capability, or omit to clear the listing cache (e.g. on bulk changes).
 */
export function invalidateCapabilitiesCache(slug?: string): void {
  if (typeof slug === "string" && slug.length > 0) {
    // Repo-scoped key shape: `capability:owner:repo:slug`. Wipe across repos.
    invalidateCache("capability:");
    revalidateTagSafe(`gh:capability:${slug}`);
  } else {
    invalidateCache("capabilities:");
    revalidateTagSafe("gh:capabilities");
  }
}

/**
 * Invalidate cache entries for workflow runs and check runs.
 * Use after a webhook arrives signaling a run/job state change.
 */
export function invalidateWorkflowCache(): void {
  invalidateCache("workflows:");
  invalidateCache("checks:");
  invalidateCache("runs:");
  revalidateTagSafe("gh:workflows");
}

// ============ Per-Request Repo Context ============
//
// The dashboard supports per-user repos (user logs in with their own GitHub
// token and a target repo). Each request carries its own owner/repo/octokit.
//
// This MUST be request-scoped, not a module-level variable. Vercel Fluid
// Compute runs multiple requests concurrently inside one warm instance, so a
// shared variable lets one request's clearGitHubContext() null out another
// request's in-flight Octokit — which surfaces as the flapping
// "GitHub token is not configured" error when several dashboard panels poll at
// once. AsyncLocalStorage gives each request an isolated store that survives
// across awaits and cannot bleed into a concurrent request.

interface GitHubContext {
  owner: string;
  repo: string;
  octokit: Octokit | null;
  storeRepoUrl?: string;
  storeRef?: string;
}

// Lazy AsyncLocalStorage — keeps the `async_hooks` Node builtin out of client
// bundles. github-client.ts is transitively imported by client components
// (TaskDetail, ModelsManager, …) for its types/helpers; a *static* import of
// `node:async_hooks` made those browser bundles fail to compile
// (UnhandledSchemeError). Acquired lazily on first use so webpack never has to
// resolve the builtin for the client target. Server-side this is the real
// store; client-side webpack stubs `async_hooks`, the constructor throws, and
// the request-context paths (which the client never reaches) become no-ops.
// Mirrors the lazy `require("next/cache")` in revalidateTagSafe above.
type GitHubContextStore = {
  getStore(): GitHubContext | undefined;
  enterWith(ctx: GitHubContext): void;
};

let requestContextSingleton: GitHubContextStore | null | undefined;

function requestContext(): GitHubContextStore | null {
  if (requestContextSingleton !== undefined) return requestContextSingleton;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { AsyncLocalStorage } =
      require("async_hooks") as typeof import("node:async_hooks");
    /* eslint-enable @typescript-eslint/no-require-imports */
    requestContextSingleton = new AsyncLocalStorage<GitHubContext>();
  } catch {
    requestContextSingleton = null;
  }
  return requestContextSingleton;
}

export function getOwner(): string {
  return requestContext()?.getStore()?.owner ?? GITHUB_OWNER;
}

export function getRepo(): string {
  return requestContext()?.getStore()?.repo ?? GITHUB_REPO;
}

export function getStoreRef(): string | undefined {
  return requestContext()?.getStore()?.storeRef;
}

export function getStoreRepoUrl(): string | undefined {
  return requestContext()?.getStore()?.storeRepoUrl;
}

/**
 * Set the repo context for the current request.
 * API routes MUST call this before any github-client calls and
 * clearGitHubContext() in a finally.
 *
 * Scoped to the current request's async execution via
 * AsyncLocalStorage.enterWith — concurrent requests never share it.
 *
 * @param owner - GitHub repo owner (e.g. "aharonyaircohen")
 * @param repo  - GitHub repo name (e.g. "Kody-ADE-Engine")
 * @param token - GitHub token (user's PAT). Falls back to env token if omitted.
 */
export function setGitHubContext(
  owner: string,
  repo: string,
  token?: string,
  storeRepoUrl?: string,
  storeRef?: string,
): void {
  const authToken =
    token ??
    process.env.KODY_BOT_TOKEN ??
    process.env.GITHUB_TOKEN ??
    process.env.GH_PAT ??
    null;
  if (!authToken) {
    throw new Error(
      "No GitHub token configured. Set KODY_BOT_TOKEN, GITHUB_TOKEN, or GH_PAT.",
    );
  }

  const MyOctokit = Octokit.plugin(throttling);
  const octokit = new MyOctokit({
    auth: authToken,
    throttle: {
      onRateLimit: (retryAfter, _options, _octokit) => {
        if (_options.request?.headers?.["x-octokit-retry-count"] === 0) {
          console.warn(`[Kody] Rate limited, retrying after ${retryAfter}s`);
          return true;
        }
        console.error(`[Kody] Rate limit hit twice, giving up`);
        return false;
      },
      onSecondaryRateLimit: (retryAfter, _options, _octokit) => {
        const retryCount = (_options.request?.retryCount as number) ?? 0;
        if (retryCount < 2) {
          console.warn(
            `[Kody] Secondary rate limit, retrying after ${retryAfter}s (attempt ${retryCount + 1}/2)`,
          );
          return true;
        }
        console.error(
          `[Kody] Secondary rate limit hit ${retryCount + 1} times, giving up`,
        );
        return false;
      },
    },
  });

  requestContext()?.enterWith({
    owner,
    repo,
    octokit,
    storeRepoUrl: storeRepoUrl?.trim() || undefined,
    storeRef: storeRef?.trim() || undefined,
  });
}

export function clearGitHubContext(): void {
  // Drop this request's Octokit so it can be GC'd. Scoped to the current async
  // context, so it can never clear a concurrent request's context.
  requestContext()?.enterWith({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    octokit: null,
  });
}

// ============ Octokit Singleton ============

let octokitInstance: Octokit | null = null;

type ThrottledOctokit = Octokit & ReturnType<typeof throttling>;

export function getOctokit(): Octokit {
  // Use the per-request context Octokit when set (via setGitHubContext)
  const ctxOctokit = requestContext()?.getStore()?.octokit;
  if (ctxOctokit) return ctxOctokit as ThrottledOctokit;
  if (octokitInstance) return octokitInstance as ThrottledOctokit;

  // Prefer KODY_BOT_TOKEN if set (for bot attribution), otherwise fall back to GITHUB_TOKEN / GH_PAT
  const token =
    process.env.KODY_BOT_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_PAT;
  if (!token) {
    throw new Error(
      "No GitHub token configured. Set KODY_BOT_TOKEN, GITHUB_TOKEN, or GH_PAT.",
    );
  }

  // Create Octokit with throttling plugin - auto-retries on rate limits
  const MyOctokit = Octokit.plugin(throttling);
  octokitInstance = new MyOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, _options, _octokit) => {
        // Retry once after rate limit, then stop
        if (_options.request?.headers?.["x-octokit-retry-count"] === 0) {
          console.warn(`[Kody] Rate limited, retrying after ${retryAfter}s`);
          return true;
        }
        console.error(`[Kody] Rate limit hit twice, giving up`);
        return false;
      },
      onSecondaryRateLimit: (retryAfter, _options, _octokit) => {
        // Secondary rate limit (abuse detection) — retry up to 2 times, then stop to avoid token ban
        const retryCount = (_options.request?.retryCount as number) ?? 0;
        if (retryCount < 2) {
          console.warn(
            `[Kody] Secondary rate limit, retrying after ${retryAfter}s (attempt ${retryCount + 1}/2)`,
          );
          return true;
        }
        console.error(
          `[Kody] Secondary rate limit hit ${retryCount + 1} times, giving up to avoid token ban`,
        );
        return false;
      },
    },
  });

  return octokitInstance as ThrottledOctokit;
}

/**
 * Create a per-request Octokit instance for a user's GitHub token.
 * Used for write operations so they appear under the user's identity.
 * Does NOT cache — each call creates a fresh instance.
 */
export function createUserOctokit(token: string): Octokit {
  const MyOctokit = Octokit.plugin(throttling);
  const instance = new MyOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, _options, _octokit) => {
        if (_options.request?.headers?.["x-octokit-retry-count"] === 0) {
          console.warn(
            `[Kody/User] Rate limited, retrying after ${retryAfter}s`,
          );
          return true;
        }
        console.error(`[Kody/User] Rate limit hit twice, giving up`);
        return false;
      },
      onSecondaryRateLimit: (retryAfter, _options, _octokit) => {
        console.warn(
          `[Kody/User] Secondary rate limit, retrying after ${retryAfter}s`,
        );
        return true;
      },
    },
  });
  return instance;
}

// ============ Utility ============

/**
 * Clear all cache (for testing or manual refresh)
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Clear specific cache categories
 */
export function clearCacheByCategory(
  category: "all" | "tasks" | "prs" | "boards" | "branches",
): void {
  switch (category) {
    case "all":
      cache.clear();
      break;
    case "tasks":
      invalidateTaskCache();
      break;
    case "prs":
      invalidatePRCache();
      break;
    case "boards":
      invalidateBoardCache();
      break;
    case "branches":
      invalidateBranchCache();
      break;
  }
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}

// CI status now lives on each GitHubPR returned by `fetchOpenPRs` — no separate
// per-PR fetch. See `derivePRCi` and the OpenPRs GraphQL query above.

