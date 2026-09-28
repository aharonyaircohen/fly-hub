/**
 * @fileType utility
 * @domain variables
 * @pattern convex-backend
 * @ai-summary Read/write repo plaintext variables in the Convex backend
 * (repoDocs, kind "variables", doc = the VariablesDocument — the same JSON
 * `variables.json` used to hold, so the export/import mapping round-trips
 * unchanged). Sensitive values still belong in the encrypted vault. Returned
 * `sha` is always null/"" (Convex docs have no git blob, and repoDocs.save
 * upserts so there is no CAS conflict to retry).
 */

import { backendApi, getConvexClient, tenantIdFor } from "../backend/convex";

export const VARIABLES_PATH = "variables.json";
const VARIABLES_KIND = "variables";

export interface VariableMeta {
  updatedAt: string;
  updatedBy?: string;
}

export interface VariableEntry extends VariableMeta {
  value: string;
}

export interface VariablesDocument {
  version: 1;
  variables: Record<string, VariableEntry>;
}

interface CacheEntry {
  doc: VariablesDocument;
  sha: string | null;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<
  string,
  Promise<{ doc: VariablesDocument; sha: string | null }>
>();
const TTL_MS = 60_000;

function cacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function emptyDoc(): VariablesDocument {
  return { version: 1, variables: {} };
}

async function fetchRaw(
  owner: string,
  repo: string,
): Promise<{ doc: VariablesDocument; sha: string | null }> {
  const record = (await getConvexClient().query(backendApi.repoDocs.get, {
    tenantId: tenantIdFor(owner, repo),
    kind: VARIABLES_KIND,
  })) as { doc?: unknown } | null;

  if (!record) return { doc: emptyDoc(), sha: null };

  const parsed = record.doc as VariablesDocument;
  if (parsed?.version !== 1 || typeof parsed.variables !== "object") {
    throw new Error("Variables document has unexpected shape");
  }

  return { doc: parsed, sha: null };
}

export async function readVariables(
  owner: string,
  repo: string,
  options: { force?: boolean } = {},
): Promise<{ doc: VariablesDocument; sha: string | null }> {
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

export async function writeVariables(
  owner: string,
  repo: string,
  doc: VariablesDocument,
): Promise<{ sha: string }> {
  await getConvexClient().mutation(backendApi.repoDocs.save, {
    tenantId: tenantIdFor(owner, repo),
    kind: VARIABLES_KIND,
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

export function invalidateVariablesCache(owner: string, repo: string): void {
  CACHE.delete(cacheKey(owner, repo));
}

/**
 * Read-modify-write helper. `mutate` is pure and runs on the latest document.
 * Kept the retry loop shape from the backend era for transient errors,
 * though Convex upserts no longer produce 409 SHA conflicts.
 */
export async function updateVariables(
  owner: string,
  repo: string,
  mutate: (doc: VariablesDocument) => VariablesDocument,
  maxAttempts = 3,
): Promise<{ doc: VariablesDocument }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { doc } = await readVariables(owner, repo, {
      force: true,
    });
    const next = mutate(doc);
    try {
      await writeVariables(owner, repo, next);
      invalidateVariablesCache(owner, repo);
      return { doc: next };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409 && attempt < maxAttempts) {
        invalidateVariablesCache(owner, repo);
        await new Promise((r) => setTimeout(r, 150 * attempt));
        continue;
      }
      throw err;
    }
  }

  throw new Error("variables: write failed after retries");
}

export function listVariables(doc: VariablesDocument): Array<{
  name: string;
  value: string;
  updatedAt: string;
  updatedBy?: string;
}> {
  return Object.entries(doc.variables)
    .map(([name, entry]) => ({
      name,
      value: entry.value,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
