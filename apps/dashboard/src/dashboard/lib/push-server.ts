/**
 * @fileType utility
 * @domain kody
 * @pattern push-subscriptions-convex-store
 * @ai-summary Server-only helpers for the Convex push-subscriptions manifest.
 */
import {
  createBackendManifestStore,
  type BackendManifestRef,
  type BackendManifestMutateOptions,
  type BackendManifestMutationOutcome,
  type BackendManifestMutator,
  type BackendManifestMutatorReturn,
} from "@kody-ade/base/backend-manifest-store";
import {
  EMPTY_PUSH_MANIFEST,
  parsePushManifest,
  type PushSubscriptionsManifest,
  type PushSubscriptionRecord,
} from "./push";

// ─────────────────────────────────────────────────────────────────────────────
// CAS verify — two-level field-by-field (manifest → each subscription)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard cap on durable push subscriptions per repo. Each record is ~600 bytes
 * (endpoint URL + two base64 keys + label + timestamps), so 1000 entries fits
 * comfortably under the manifest-store byte budget with plenty of headroom for
 * the JSON wrapper. Trim drops the *least-recently-seen* device first — the
 * least likely to still be alive — so an organic install/uninstall churn never
 * silently freezes new sign-ups.
 */
const MAX_PUSH_SUBSCRIPTIONS = 1000;

function trimOldestSubscriptions(
  manifest: PushSubscriptionsManifest,
): PushSubscriptionsManifest {
  if (manifest.subscriptions.length <= MAX_PUSH_SUBSCRIPTIONS) return manifest;
  // Recency = lastSeenAt if known, else createdAt. Sort newest-first, slice
  // to the cap, preserve the original order so equals/CAS stays stable.
  const ranked = manifest.subscriptions
    .map((sub, idx) => ({
      sub,
      idx,
      seenAt: sub.lastSeenAt ?? sub.createdAt,
    }))
    .sort((a, b) => (a.seenAt < b.seenAt ? 1 : a.seenAt > b.seenAt ? -1 : 0))
    .slice(0, MAX_PUSH_SUBSCRIPTIONS)
    .sort((a, b) => a.idx - b.idx);
  return { ...manifest, subscriptions: ranked.map((r) => r.sub) };
}

const store = createBackendManifestStore<PushSubscriptionsManifest>({
  kind: "push-subscriptions",
  name: "push manifest",
  parse: parsePushManifest,
  empty: () => ({ ...EMPTY_PUSH_MANIFEST, subscriptions: [] }),
  beforeWrite: trimOldestSubscriptions,
});

// ─────────────────────────────────────────────────────────────────────────────
// Public API (unchanged surface)
// ─────────────────────────────────────────────────────────────────────────────

export type MutateOptions = BackendManifestMutateOptions;
export type MutationOutcome<T> = BackendManifestMutationOutcome<
  PushSubscriptionsManifest,
  T
>;
export type MutatorReturn<T> = BackendManifestMutatorReturn<
  PushSubscriptionsManifest,
  T
>;
export type Mutator<T> = BackendManifestMutator<PushSubscriptionsManifest, T>;

export function mutatePushManifest<T>(
  mutator: Mutator<T>,
  options: MutateOptions = {},
): Promise<MutationOutcome<T> | { kind: "noop"; result: T }> {
  return store.mutate(mutator, options);
}

export function readPushManifest(): Promise<
  BackendManifestRef<PushSubscriptionsManifest>
> {
  return store.readFresh();
}
