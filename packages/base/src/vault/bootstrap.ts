/**
 * @fileType utility
 * @domain vault
 * @pattern convex-background-credentials
 * @ai-summary Resolves background secrets and variables directly from the
 * tenant's Convex repoDocs without requiring a GitHub token.
 */
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

import { decrypt, isVaultConfigured } from "./crypto";
import { VAULT_PATH } from "./store";

const VARIABLES_KIND = "variables";
const CACHE_TTL_MS = 10 * 60 * 1000;

interface VaultDoc {
  secrets?: Record<string, { value?: unknown }>;
}

interface VariablesDoc {
  variables?: Record<string, { value?: unknown }>;
}

const cache = new Map<string, { value: string | null; expiresAt: number }>();

async function readRepoDoc(
  owner: string,
  repo: string,
  kind: string,
): Promise<unknown | null> {
  const record = (await createBackendClient().query(api.repoDocs.get, {
    tenantId: `${owner}/${repo}`,
    kind,
  })) as { doc?: unknown } | null;
  return record?.doc ?? null;
}

async function cachedValue(
  key: string,
  resolve: () => Promise<string | null>,
): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await resolve();
  // Missing state can be created at any moment and transient backend failures
  // must stay distinguishable from absence. Cache only confirmed values.
  if (value !== null) {
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  } else {
    cache.delete(key);
  }
  return value;
}

export async function resolveVaultGithubToken(
  owner: string,
  repo: string,
  secretName = "GITHUB_TOKEN",
  _legacyFetch?: typeof fetch,
): Promise<string | null> {
  const key = `secret:${owner}/${repo}/${secretName}`.toLowerCase();
  return await cachedValue(key, async () => {
    if (!isVaultConfigured()) return null;
    const raw = (await readRepoDoc(owner, repo, VAULT_PATH)) as {
      ciphertext?: unknown;
    } | null;
    if (typeof raw?.ciphertext !== "string" || !raw.ciphertext.trim()) {
      return null;
    }
    const doc = JSON.parse(decrypt(raw.ciphertext.trim())) as VaultDoc;
    const value = doc.secrets?.[secretName]?.value;
    return typeof value === "string" && value.trim() ? value : null;
  });
}

export async function resolvePublicStateVariable(
  owner: string,
  repo: string,
  name: string,
  _legacyFetch?: typeof fetch,
): Promise<string | null> {
  const key = `variable:${owner}/${repo}/${name}`.toLowerCase();
  return await cachedValue(key, async () => {
    const doc = (await readRepoDoc(
      owner,
      repo,
      VARIABLES_KIND,
    )) as VariablesDoc | null;
    const value = doc?.variables?.[name]?.value;
    return typeof value === "string" && value.trim() ? value : null;
  });
}

export function _resetBackgroundCredentialCache(): void {
  cache.clear();
}
