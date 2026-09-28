import type { ServerProviderConfig } from "../infrastructure/server-machines";

/**
 * Kody-owned provider configuration for managed Apps.
 * Repository vault credentials intentionally do not participate in this
 * boundary; they remain source-access inputs only.
 */
export function resolveAppHostingConfig(): ServerProviderConfig | null {
  const token =
    process.env.KODY_APPS_FLY_API_TOKEN?.trim() ||
    process.env.FLY_API_TOKEN?.trim() ||
    "";
  if (!token) return null;
  return {
    token,
    orgSlug:
      process.env.KODY_APPS_FLY_ORG_SLUG ??
      process.env.FLY_ORG_SLUG ??
      "personal",
    defaultRegion:
      process.env.KODY_APPS_FLY_DEFAULT_REGION ??
      process.env.FLY_DEFAULT_REGION ??
      "fra",
  };
}
