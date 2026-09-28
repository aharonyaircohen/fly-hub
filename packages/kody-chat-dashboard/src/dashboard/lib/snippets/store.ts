/**
 * @fileType utility
 * @domain snippets
 * @pattern snippet-store
 * @ai-summary Loads and atomically mutates the brand's snippets from
 *   `snippets/config.json` in the backend. Same loader conventions as
 *   triggers: Zod-validated, invalid file tolerated (warn + empty), 60s TTL
 *   cache, CAS read-modify-write so concurrent saves never drop entries.
 */
import "server-only";
import type { Octokit } from "@octokit/rest";
import { logger } from "@kody-ade/base/logger";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  snippetsFileSchema,
  type SnippetConfig,
  type SnippetsFile,
} from "./types";

export const SNIPPETS_CONFIG_PATH = "snippets/config.json";

const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  snippets: readonly SnippetConfig[];
  expires: number;
}

const cache = new Map<string, CacheEntry>();

/** Exported for unit tests — clears the snippets cache. */
export function _resetSnippetsCache(): void {
  cache.clear();
}

function cacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

interface SnippetsFileRead {
  snippets: SnippetConfig[];
  sha: string | undefined;
}

async function readSnippetsFile(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<SnippetsFileRead> {
  try {
    void octokit;
    const row = (await createBackendClient().query(api.repoDocs.get, {
      tenantId: `${owner}/${repo}`,
      kind: SNIPPETS_CONFIG_PATH,
    })) as { doc?: unknown; updatedAt?: string } | null;
    if (!row) return { snippets: [], sha: undefined };
    const parsed = snippetsFileSchema.parse(row.doc);
    return { snippets: parsed.snippets, sha: row.updatedAt };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) {
      return { snippets: [], sha: undefined };
    }
    throw error;
  }
}

export async function getSnippets(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: { cache?: boolean } = {},
): Promise<readonly SnippetConfig[]> {
  const key = cacheKey(owner, repo);
  const useCache = options.cache !== false;
  const cached = useCache ? cache.get(key) : undefined;
  if (cached && cached.expires > Date.now()) return cached.snippets;

  let snippets: readonly SnippetConfig[] = [];
  try {
    snippets = (await readSnippetsFile(octokit, owner, repo)).snippets;
  } catch (error) {
    logger.warn({ err: error, owner, repo }, "snippets config load failed");
  }
  cache.set(key, { snippets, expires: Date.now() + CACHE_TTL_MS });
  return snippets;
}

/**
 * Atomic read-modify-write on the snippets file (CAS, single write attempt
 * per cycle, re-runs on conflict) — concurrent saves never drop entries.
 */
export async function mutateSnippets(
  octokit: Octokit,
  owner: string,
  repo: string,
  mutate: (snippets: readonly SnippetConfig[]) => readonly SnippetConfig[],
): Promise<readonly SnippetConfig[]> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
    const { snippets, sha } = await readSnippetsFile(octokit, owner, repo);
    const next = mutate(snippets);
    const file: SnippetsFile = { version: 1, snippets: [...next] };
    try {
      void octokit;
      await createBackendClient().mutation(api.repoDocs.save, {
        tenantId: `${owner}/${repo}`,
        kind: SNIPPETS_CONFIG_PATH,
        doc: file,
        updatedAt: new Date().toISOString(),
        ...(sha !== undefined ? { expectedUpdatedAt: sha } : {}),
      });
      cache.delete(cacheKey(owner, repo));
      return next;
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      const message = error instanceof Error ? error.message : "";
      const conflict =
        status === 409 ||
        status === 422 ||
        message.includes("changed since it was read");
      if (!conflict || attempt === MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error("snippets config write retry exhausted");
}
