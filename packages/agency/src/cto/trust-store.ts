/**
 * @fileType utility
 * @domain kody
 * @pattern capability-trust-convex-store
 * @ai-summary Server-only capability trust storage in the shared Convex
 *   backend. The manifest remains repo-scoped and mutations use optimistic
 *   concurrency through the shared backend-manifest adapter.
 */
import "server-only"
import { createBackendManifestStore } from "@kody-ade/base/backend-manifest-store"
import {
  EMPTY_TRUST_MANIFEST,
  parseTrustManifest,
  serializeTrustManifest,
  type TrustManifest,
} from "./trust-state"

const store = createBackendManifestStore<TrustManifest>({
  kind: "capability-trust",
  name: "capability trust ledger",
  empty: () => structuredClone(EMPTY_TRUST_MANIFEST),
  parse: (value) => parseTrustManifest(serializeTrustManifest(value as TrustManifest)),
})

/** Retained as a test seam; Convex reads do not use a process-local cache. */
export function _resetTrustCache(): void {}

export async function readTrust(): Promise<TrustManifest> {
  return (await store.readFresh()).manifest
}

export async function mutateTrust(
  mutator: (current: TrustManifest) => TrustManifest,
): Promise<TrustManifest> {
  const outcome = await store.mutate((current) => ({
    next: mutator(current),
    result: null,
  }))
  if ("kind" in outcome) return await readTrust()
  return outcome.manifest
}
