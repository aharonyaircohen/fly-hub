import { MANAGED_BACKGROUND_GITHUB_TOKEN } from "./background-token-contract";

export const KODY_INTERNAL_CREDENTIAL_PREFIX = "KODY_INTERNAL_";

export function isInternalKodyCredential(name: string): boolean {
  return (
    name === MANAGED_BACKGROUND_GITHUB_TOKEN ||
    name.startsWith(KODY_INTERNAL_CREDENTIAL_PREFIX)
  );
}
