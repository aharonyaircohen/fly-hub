import { ConvexHttpClient } from "convex/browser"
import { deepEscapeKeys, deepUnescapeKeys } from "./escape-keys"

// Convex reserves object keys starting with `$`/`_` (the wire rejects them
// before any function runs), so escaping cannot live server-side. Every
// client wraps here: args are deep-escaped on the way in, results are
// deep-unescaped on the way out, and callers never see the scheme.

type CallMethod = "query" | "mutation" | "action"
const CALL_METHODS: readonly CallMethod[] = ["query", "mutation", "action"]

/**
 * Service auth injection: every Convex function (via serviceQuery /
 * serviceMutation in convex/lib/auth.ts, or an explicit optional arg on the
 * deliberately-public queries) accepts a `serviceKey` arg, verified against
 * the deployment's KODY_SERVICE_KEY env var. Injecting it here means the
 * ~25 server call sites need no per-call changes. When the env var is unset
 * (e.g. unit tests, local convex-test) nothing is injected.
 */
function injectServiceKey(args: unknown): unknown {
  const serviceKey = process.env.KODY_SERVICE_KEY
  if (!serviceKey) return args
  if (args === undefined) return { serviceKey }
  if (typeof args !== "object" || args === null || Array.isArray(args)) return args
  return { ...args, serviceKey }
}

/**
 * Wraps a ConvexHttpClient so query/mutation/action args have reserved-prefix
 * keys escaped and results are unescaped — any payload round-trips intact.
 * Also injects the KODY_SERVICE_KEY service secret into every call (see
 * injectServiceKey) so this single wrapper is the whole server-auth story.
 */
export function withEscapedKeys(client: ConvexHttpClient): ConvexHttpClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (CALL_METHODS.includes(prop as CallMethod)) {
        const method = Reflect.get(target, prop, target) as (
          fn: unknown,
          args?: unknown,
        ) => Promise<unknown>
        return async (fn: unknown, args?: unknown) => {
          const authed = injectServiceKey(args)
          const result = await method.call(
            target,
            fn,
            authed === undefined ? undefined : deepEscapeKeys(authed),
          )
          return deepUnescapeKeys(result)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

// Server-side client factory for API routes and runners. The browser side
// should use ConvexReactClient with NEXT_PUBLIC_CONVEX_URL instead (and
// unescape reserved-prefix keys on subscription results).
export function createBackendClient(url = process.env.CONVEX_URL): ConvexHttpClient {
  if (!url) {
    throw new Error("CONVEX_URL not configured")
  }
  return withEscapedKeys(new ConvexHttpClient(url))
}
