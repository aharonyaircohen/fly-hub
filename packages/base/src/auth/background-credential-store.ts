import "server-only";

import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

import { decrypt, encrypt, isVaultConfigured } from "../vault/crypto";
import { _resetBackgroundCredentialCache } from "../vault/bootstrap";

const BACKGROUND_CREDENTIAL_KIND = "background-github-credential";
const CACHE_TTL_MS = 10 * 60 * 1000;
const credentialCache = new Map<
  string,
  { token: string | null; expiresAt: number }
>();

interface ManagedBackgroundCredential {
  version: 1;
  provider: "pat";
  token: string;
  updatedAt: string;
  updatedBy?: string;
}

interface StoredCredentialRecord {
  doc?: { ciphertext?: unknown };
  updatedAt?: string;
}

function tenantId(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

export function isBackgroundCredentialStoreConfigured(): boolean {
  return isVaultConfigured();
}

export async function readManagedBackgroundCredential(
  owner: string,
  repo: string,
): Promise<string | null> {
  if (!isBackgroundCredentialStoreConfigured()) return null;
  const cacheKey = tenantId(owner, repo).toLowerCase();
  const cached = credentialCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const record = (await createBackendClient().query(api.repoDocs.get, {
    tenantId: tenantId(owner, repo),
    kind: BACKGROUND_CREDENTIAL_KIND,
  })) as StoredCredentialRecord | null;
  const ciphertext = record?.doc?.ciphertext;
  if (typeof ciphertext !== "string" || !ciphertext.trim()) {
    credentialCache.set(cacheKey, {
      token: null,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return null;
  }

  const credential = JSON.parse(
    decrypt(ciphertext.trim()),
  ) as Partial<ManagedBackgroundCredential>;
  if (
    credential.version !== 1 ||
    credential.provider !== "pat" ||
    typeof credential.token !== "string" ||
    !credential.token.trim()
  ) {
    throw new Error("Background credential has unexpected shape");
  }
  credentialCache.set(cacheKey, {
    token: credential.token,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return credential.token;
}

export async function writeManagedBackgroundCredential(input: {
  owner: string;
  repo: string;
  token: string;
  actorLogin?: string | null;
  updatedAt: string;
}): Promise<void> {
  const client = createBackendClient();
  const tenant = tenantId(input.owner, input.repo);
  const current = (await client.query(api.repoDocs.get, {
    tenantId: tenant,
    kind: BACKGROUND_CREDENTIAL_KIND,
  })) as StoredCredentialRecord | null;
  const credential: ManagedBackgroundCredential = {
    version: 1,
    provider: "pat",
    token: input.token,
    updatedAt: input.updatedAt,
    ...(input.actorLogin ? { updatedBy: input.actorLogin } : {}),
  };
  await client.mutation(api.repoDocs.save, {
    tenantId: tenant,
    kind: BACKGROUND_CREDENTIAL_KIND,
    doc: { ciphertext: encrypt(JSON.stringify(credential)) },
    updatedAt: input.updatedAt,
    ...(current?.updatedAt
      ? { expectedUpdatedAt: current.updatedAt }
      : {}),
  });
  credentialCache.delete(tenant.toLowerCase());
  _resetBackgroundCredentialCache();
}

export async function deleteManagedBackgroundCredential(
  owner: string,
  repo: string,
): Promise<void> {
  await createBackendClient().mutation(api.repoDocs.remove, {
    tenantId: tenantId(owner, repo),
    kind: BACKGROUND_CREDENTIAL_KIND,
  });
  credentialCache.delete(tenantId(owner, repo).toLowerCase());
  _resetBackgroundCredentialCache();
}
