/**
 * @fileType utility
 * @domain auth
 * @pattern background-token-policy
 * @ai-summary The single token resolver for unattended background work
 *   (webhook fan-out, ownerless server flows). Policy, not mechanism: prefer
 *   the GitHub App installation token (its own per-install rate-limit bucket,
 *   can't flag a human account), and fall back to the repo's vault
 *   `GITHUB_TOKEN` only when the App isn't installed/configured.
 *
 *   Every webhook dispatcher resolves its token here so the App-vs-vault
 *   decision lives in one place. The Kody-managed vault key is the primary PAT
 *   fallback; the user-owned `GITHUB_TOKEN` remains a migration fallback.
 *   Returns null when no source yields a token.
 */
import "server-only";
import { getInstallationToken } from "./app-token";
import { resolveVaultGithubToken } from "../vault/bootstrap";
import { MANAGED_BACKGROUND_GITHUB_TOKEN } from "./background-token-contract";
import { readManagedBackgroundCredential } from "./background-credential-store";

export interface BackgroundToken {
  token: string;
  /** Which source supplied it — for logging / attribution clarity. */
  source: "app" | "managed-store" | "managed-vault" | "vault";
}

/**
 * Resolve a token for background work on `owner/repo`. App installation token
 * first; Kody-managed vault token second; legacy `GITHUB_TOKEN` last.
 */
export async function resolveBackgroundToken(
  owner: string,
  repo: string,
): Promise<BackgroundToken | null> {
  const appToken = await getInstallationToken(owner, repo);
  if (appToken) return { token: appToken, source: "app" };

  const managedToken = await readManagedBackgroundCredential(owner, repo);
  if (managedToken) return { token: managedToken, source: "managed-store" };

  // Migration fallback for credentials stored before the dedicated boundary.
  const managedVaultToken = await resolveVaultGithubToken(
    owner,
    repo,
    MANAGED_BACKGROUND_GITHUB_TOKEN,
  );
  if (managedVaultToken) {
    return { token: managedVaultToken, source: "managed-vault" };
  }

  const vaultToken = await resolveVaultGithubToken(owner, repo);
  if (vaultToken) return { token: vaultToken, source: "vault" };

  return null;
}
