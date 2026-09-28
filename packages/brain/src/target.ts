/**
 * @fileType utility
 * @domain brain
 * @pattern brain-target-resolution
 *
 * Resolves the Fly app name and org as one unit. A stored Brain record owns
 * both values; callers should not use the stored app with a different org.
 */

import { type BrainAppFile } from "./store";
import { slugifyTitle } from "@kody-ade/base/slug";

export type BrainTargetSource = "override" | "stored" | "default";

export interface BrainTarget {
  app: string;
  orgSlug: string;
  source: BrainTargetSource;
}

function defaultBrainAppName(account: string): string {
  return `kody-brain-${slugifyTitle(account, {
    fallback: "account",
    allowUnderscore: false,
  })}`;
}

export function resolveBrainTarget(input: {
  account: string;
  contextOrgSlug: string;
  stored: BrainAppFile | null;
  appNameOverride?: string;
}): BrainTarget {
  const override = input.appNameOverride?.trim();
  if (override) {
    return {
      app: override,
      orgSlug:
        input.stored?.appName === override
          ? input.stored.orgSlug
          : input.contextOrgSlug,
      source: "override",
    };
  }

  // New records carry the account that provisioned them, so custom names
  // remain usable after reload. Preserve the old name guard only for legacy
  // records whose ownership was never recorded.
  const looksLikeForeignDefault =
    input.stored?.appName.startsWith("kody-brain-") === true &&
    input.stored.appName !== defaultBrainAppName(input.account);
  const belongsToAccount = input.stored?.ownerAccount
    ? input.stored.ownerAccount === input.account
    : !looksLikeForeignDefault;
  if (input.stored && belongsToAccount) {
    return {
      app: input.stored.appName,
      orgSlug: input.stored.orgSlug,
      source: "stored",
    };
  }

  return {
    app: defaultBrainAppName(input.account),
    orgSlug: input.contextOrgSlug,
    source: "default",
  };
}
