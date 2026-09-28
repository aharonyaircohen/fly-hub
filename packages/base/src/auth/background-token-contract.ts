/** Retired vault key kept only to read and hide already-provisioned credentials. */
export const MANAGED_BACKGROUND_GITHUB_TOKEN = "KODY_GITHUB_TOKEN";

export type BackgroundGitHubAccessProvisionResult =
  | { ok: true; source: "github-app" | "encrypted-pat" }
  | { ok: false; reason: "credential-store-not-configured" };
