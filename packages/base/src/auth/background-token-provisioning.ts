import type { BackgroundGitHubAccessProvisionResult } from "./background-token-contract";
import { getInstallationToken } from "./app-token";
import {
  deleteManagedBackgroundCredential,
  isBackgroundCredentialStoreConfigured,
  writeManagedBackgroundCredential,
} from "./background-credential-store";

/**
 * Prefer repository-owned GitHub App access. Persist an encrypted human PAT
 * only as a fallback when the App is not installed for this repository.
 */
export async function provisionBackgroundGitHubAccess(input: {
  owner: string;
  repo: string;
  token: string;
  actorLogin?: string | null;
  now?: string;
}): Promise<BackgroundGitHubAccessProvisionResult> {
  const installationToken = await getInstallationToken(input.owner, input.repo);
  if (installationToken) {
    await deleteManagedBackgroundCredential(input.owner, input.repo);
    return { ok: true, source: "github-app" };
  }

  if (!isBackgroundCredentialStoreConfigured()) {
    return { ok: false, reason: "credential-store-not-configured" };
  }

  await writeManagedBackgroundCredential({
    owner: input.owner,
    repo: input.repo,
    token: input.token,
    actorLogin: input.actorLogin,
    updatedAt: input.now ?? new Date().toISOString(),
  });
  return { ok: true, source: "encrypted-pat" };
}
