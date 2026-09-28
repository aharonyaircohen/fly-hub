/**
 * @fileType utility
 * @domain kody
 * @pattern notifications-convex-store
 * @ai-summary Server-only helpers for the Convex notifications manifest.
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
  EMPTY_MANIFEST,
  parseNotificationsManifest,
  type NotificationsManifest,
} from "./notifications";

// ─────────────────────────────────────────────────────────────────────────────
// CAS verify — field-by-field per rule; channel compared by JSON.stringify
// (scalar fields, non-overlapping union shapes — matches serialized bytes)
// ─────────────────────────────────────────────────────────────────────────────

const store = createBackendManifestStore<NotificationsManifest>({
  kind: "notification-rules",
  name: "notifications manifest",
  parse: parseNotificationsManifest,
  empty: () => ({ ...EMPTY_MANIFEST, rules: [] }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Public API (unchanged surface)
// ─────────────────────────────────────────────────────────────────────────────

export type MutateOptions = BackendManifestMutateOptions;
export type MutationOutcome<T> = BackendManifestMutationOutcome<
  NotificationsManifest,
  T
>;
export type MutatorReturn<T> = BackendManifestMutatorReturn<NotificationsManifest, T>;
export type Mutator<T> = BackendManifestMutator<NotificationsManifest, T>;

export function mutateNotificationsManifest<T>(
  mutator: Mutator<T>,
  options: MutateOptions = {},
): Promise<MutationOutcome<T> | { kind: "noop"; result: T }> {
  return store.mutate(mutator, options);
}

/**
 * Read-only fresh accessor for the webhook handler / dispatcher (cache
 * bypass — the dispatcher should always see the latest rule state).
 */
export function readNotificationsManifestFresh(): Promise<
  BackendManifestRef<NotificationsManifest>
> {
  return store.readFresh();
}
