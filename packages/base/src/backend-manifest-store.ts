import { api as backendApi } from "@kody-ade/backend/api"
import { createBackendClient } from "@kody-ade/backend/client"
import { getOwner, getRepo } from "./github/core"
import { DEFAULT_MAX_BODY_BYTES, ManifestBodyTooLargeError, withRepoLock } from "./manifest-store"

export interface BackendManifestRef<M> {
  number: null
  manifest: M
}

export interface BackendManifestMutateOptions {
  maxAttempts?: number
  userOctokit?: unknown
}

export type BackendManifestMutatorReturn<M, T> =
  | { next: M; result: T }
  | { kind: "noop"; result: T }

export type BackendManifestMutator<M, T> = (
  current: M,
) => BackendManifestMutatorReturn<M, T> | Promise<BackendManifestMutatorReturn<M, T>>

export interface BackendManifestMutationOutcome<M, T> {
  result: T
  manifest: M
}

type StoredManifest = {
  doc: unknown
  updatedAt: string
}

export function createBackendManifestStore<M>(config: {
  kind: string
  name: string
  empty: () => M
  parse: (value: unknown) => M
  beforeWrite?: (manifest: M) => M
  maxBytes?: number
}) {
  const beforeWrite = config.beforeWrite ?? ((manifest: M) => manifest)
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BODY_BYTES

  function address(): { tenantId: string; kind: string } {
    return { tenantId: `${getOwner()}/${getRepo()}`, kind: config.kind }
  }

  async function readStored(): Promise<StoredManifest | null> {
    return await createBackendClient().query(backendApi.manifests.get, address()) as StoredManifest | null
  }

  async function readFresh(): Promise<BackendManifestRef<M>> {
    const stored = await readStored()
    return {
      number: null,
      manifest: stored ? config.parse(stored.doc) : config.empty(),
    }
  }

  async function mutate<T>(
    mutator: BackendManifestMutator<M, T>,
    options: BackendManifestMutateOptions = {},
  ): Promise<BackendManifestMutationOutcome<M, T> | { kind: "noop"; result: T }> {
    const { tenantId, kind } = address()
    return await withRepoLock(`convex-manifest:${tenantId}:${kind}`, async () => {
      const maxAttempts = options.maxAttempts ?? 3
      let lastError: unknown
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const stored = await readStored()
        const current = stored ? config.parse(stored.doc) : config.empty()
        const mutation = await mutator(current)
        if ("kind" in mutation && mutation.kind === "noop") return mutation

        const written = mutation as { next: M; result: T }
        const safe = beforeWrite(written.next)
        const bytes = JSON.stringify(safe).length
        if (bytes > maxBytes) throw new ManifestBodyTooLargeError(config.name, bytes, maxBytes)
        try {
          await createBackendClient().mutation(backendApi.manifests.save, {
            tenantId,
            kind,
            doc: safe,
            updatedAt: new Date().toISOString(),
            ...(stored ? { expectedUpdatedAt: stored.updatedAt } : {}),
          })
          return { result: written.result, manifest: safe }
        } catch (error: unknown) {
          lastError = error
          if (/Manifest changed since it was read/i.test(error instanceof Error ? error.message : String(error))) {
            continue
          }
          throw error
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error(`${config.name} write conflict after ${maxAttempts} attempts`)
    })
  }

  return { readFresh, mutate }
}
