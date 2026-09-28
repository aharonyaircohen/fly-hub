/**
 * @fileType utility
 * @domain kody
 * @pattern health-probe-vault
 * @ai-summary Reports whether unattended GitHub work has a usable credential
 *   for this repository. The credential can come from the GitHub App, Kody's
 *   encrypted repository store, or the legacy vault fallback.
 */
import type { HealthSignal } from "./types";

/**
 * Build the vault HealthSignal from resolved inputs. Pure — unit-tested.
 *  - master key unset      ⇒ degraded: vault disabled, falls back to env.
 *  - configured, no access ⇒ degraded: webhook background writes will no-op.
 *  - configured + access   ⇒ ok.
 */
export function buildVaultSignal(input: {
  configured: boolean;
  hasGithubToken: boolean;
}): HealthSignal {
  const base: Pick<HealthSignal, "id" | "label"> = {
    id: "vault",
    label: "Background GitHub access",
  };
  if (!input.configured) {
    return {
      ...base,
      level: "degraded",
      detail:
        "Encrypted credential storage is not configured (KODY_MASTER_KEY unset).",
    };
  }
  if (!input.hasGithubToken) {
    return {
      ...base,
      level: "degraded",
      detail:
        "No background GitHub credential is available for webhook-driven work.",
    };
  }
  return {
    ...base,
    level: "ok",
    detail: "Background GitHub access is configured.",
  };
}
