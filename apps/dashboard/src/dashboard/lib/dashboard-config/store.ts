/**
 * @fileType utility
 * @domain dashboard-config
 * @pattern convex-backend
 * @ai-summary Read/write the per-repo dashboard config doc in Convex
 * (`repoDocs` kind `dashboard-config`; historically `dashboard.json` in the
 * backend, which now only receives export copies). Mirrors vault store
 * pattern (cache + in-flight dedup + 60s TTL) without crypto; this doc is
 * not secret. Currently holds preview and dashboard preferences.
 */

import { logger } from "@kody-ade/base/logger";
import type {
  PreviewEnvironment,
  PreviewEnvironmentFolder,
} from "@kody-ade/fly/preview-environments";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "../backend/convex-backend";
import type { StoredFileSpaceConfig } from "./types";

export const DASHBOARD_CONFIG_PATH = "dashboard.json";
const DASHBOARD_CONFIG_KIND = "dashboard-config";

export interface DashboardConfig {
  version: 1;
  /** Repository-backed workspaces shown as first-class navigation pages. */
  fileSpaces?: StoredFileSpaceConfig[];
  /**
   * Legacy single preview URL shown in Vibe pane when no issue is selected.
   * Superseded by `namedPreviews` (migrated on read), kept so existing repos
   * and Vibe fallback keep working.
   */
  defaultPreviewUrl?: string;
  /**
   * Named preview environments (Production / Staging / Dev ...) surfaced on
   * the standalone `/preview` page. Each is a base URL; Web/Admin "views" are
   * paths under whichever environment is selected.
   */
  namedPreviews?: PreviewEnvironment[];
  /** User-created folders for organizing saved preview environments. */
  previewFolders?: PreviewEnvironmentFolder[];
  /**
   * Whether the "Repo Brain" row is offered in chat picker.
   * Per-repo, default `false`; Fly task execution stays driven solely by the
   * repo's `FLY_API_TOKEN`.
   */
  brainFlyChatEnabled?: boolean;
  /**
   * Branch names with live, manually-created Fly previews (e.g. `dev`).
   * Unlike PR previews there is no PR-close webhook to tear these down, so
   * this list is the leak-visibility surface for `/runner`.
   */
  branchPreviews?: string[];
}

interface CacheEntry {
  doc: DashboardConfig;
  sha: string | null;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<
  string,
  Promise<{ doc: DashboardConfig; sha: string | null }>
>();
const TTL_MS = 60_000;

function cacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function emptyDoc(): DashboardConfig {
  return { version: 1 };
}

async function fetchRaw(
  owner: string,
  repo: string,
): Promise<{ doc: DashboardConfig; sha: string | null }> {
  const record = (await getConvexClient().query(backendApi.repoDocs.get, {
    tenantId: tenantIdFor(owner, repo),
    kind: DASHBOARD_CONFIG_KIND,
  })) as { doc: unknown } | null;
  if (!record) {
    return { doc: emptyDoc(), sha: null };
  }

  const parsed = record.doc as DashboardConfig;
  if (parsed.version !== 1) {
    logger.warn(
      { owner, repo, version: parsed.version },
      "dashboard-config: unexpected version",
    );
    return { doc: emptyDoc(), sha: null };
  }

  return { doc: parsed, sha: null };
}

export async function readDashboardConfig(
  owner: string,
  repo: string,
  options: { force?: boolean } = {},
): Promise<{ doc: DashboardConfig; sha: string | null }> {
  const key = cacheKey(owner, repo);
  if (!options.force) {
    const cached = CACHE.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { doc: cached.doc, sha: cached.sha };
    }
  }

  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;

  const promise = fetchRaw(owner, repo)
    .then((result) => {
      CACHE.set(key, {
        doc: result.doc,
        sha: result.sha,
        expiresAt: Date.now() + TTL_MS,
      });
      return result;
    })
    .finally(() => {
      INFLIGHT.delete(key);
    });

  INFLIGHT.set(key, promise);
  return promise;
}

export async function writeDashboardConfig(
  owner: string,
  repo: string,
  doc: DashboardConfig,
): Promise<{ sha: string }> {
  await getConvexClient().mutation(backendApi.repoDocs.save, {
    tenantId: tenantIdFor(owner, repo),
    kind: DASHBOARD_CONFIG_KIND,
    doc,
    updatedAt: new Date().toISOString(),
  });
  CACHE.set(cacheKey(owner, repo), {
    doc,
    sha: null,
    expiresAt: Date.now() + TTL_MS,
  });
  return { sha: "" };
}

export function invalidateDashboardConfigCache(
  owner: string,
  repo: string,
): void {
  CACHE.delete(cacheKey(owner, repo));
}

/**
 * Add or remove a branch from `branchPreviews`, reading the freshest doc first
 * so concurrent create/destroy calls do not clobber each other. Idempotent:
 * adding a known branch or removing an unknown one is a no-op write-wise.
 */
export async function setBranchPreview(
  owner: string,
  repo: string,
  branch: string,
  present: boolean,
): Promise<string[]> {
  const { doc } = await readDashboardConfig(owner, repo, {
    force: true,
  });
  const current = doc.branchPreviews ?? [];
  const has = current.includes(branch);
  if (present === has) return current;

  const nextList = present
    ? [...current, branch]
    : current.filter((b) => b !== branch);
  const next: DashboardConfig = {
    ...doc,
    version: 1,
    branchPreviews: nextList.length > 0 ? nextList : undefined,
  };

  await writeDashboardConfig(owner, repo, next);
  invalidateDashboardConfigCache(owner, repo);
  return nextList;
}
