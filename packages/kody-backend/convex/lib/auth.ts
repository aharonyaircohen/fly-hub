import { mutation, query } from "../_generated/server"
import { v } from "convex/values"

// Shared-secret auth for server-to-server calls. Convex has no built-in
// API-key auth for functions, so protected functions accept a `serviceKey`
// arg that must match the KODY_SERVICE_KEY environment variable set on the
// deployment (`npx convex env set KODY_SERVICE_KEY <value>`). The HTTP
// client wrapper (src/client.ts withEscapedKeys) injects the key from
// process.env automatically, so server call sites never pass it by hand.

/** Constant-time string comparison — avoids leaking prefix length via timing. */
function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)
  let diff = bufA.length ^ bufB.length
  const len = Math.max(bufA.length, bufB.length)
  for (let i = 0; i < len; i++) {
    diff |= (bufA[i % bufA.length] ?? 0) ^ (bufB[i % bufB.length] ?? 0)
  }
  return diff === 0
}

/**
 * Throws unless `key` matches the deployment's KODY_SERVICE_KEY. Fails
 * closed: an unset env var rejects every call rather than allowing all.
 */
export function requireServiceKey(key: string | undefined): void {
  const expected = process.env.KODY_SERVICE_KEY
  if (!expected) {
    throw new Error("KODY_SERVICE_KEY is not configured on this deployment")
  }
  if (!key || !safeEqual(key, expected)) {
    throw new Error("Unauthorized: missing or invalid serviceKey")
  }
}

type AnyHandler = (ctx: unknown, args: Record<string, unknown>) => unknown
interface FunctionDef {
  args: Record<string, unknown>
  handler: AnyHandler
}

function withServiceKeyArg(def: FunctionDef): FunctionDef {
  return {
    args: { ...def.args, serviceKey: v.optional(v.string()) },
    handler: async (ctx, { serviceKey, ...rest }) => {
      requireServiceKey(serviceKey as string | undefined)
      return def.handler(ctx, rest)
    },
  }
}

/**
 * `query` that requires a valid `serviceKey` arg. The key is stripped before
 * the inner handler runs, so handlers that forward `args` wholesale (e.g.
 * `ctx.db.insert(table, args)`) never persist it.
 */
export const serviceQuery = ((def: FunctionDef) =>
  query(withServiceKeyArg(def) as never)) as unknown as typeof query

/** `mutation` that requires a valid `serviceKey` arg — see serviceQuery. */
export const serviceMutation = ((def: FunctionDef) =>
  mutation(withServiceKeyArg(def) as never)) as unknown as typeof mutation
