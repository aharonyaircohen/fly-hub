import { convexTest } from "convex-test"
import schema from "../../convex/schema"

export const modules = import.meta.glob("../../convex/**/!(*.*.*)*.*s")

// Service-key auth (convex/lib/auth.ts) reads KODY_SERVICE_KEY from the
// deployment env; under convex-test that is this process's env. Set it before
// any handler runs, and inject the matching key into every call so existing
// test call sites stay unchanged — mirroring what the wrapped
// ConvexHttpClient (src/client.ts) does in production.
export const TEST_SERVICE_KEY = "test-service-key"
process.env.KODY_SERVICE_KEY = TEST_SERVICE_KEY

type Fn = (fnRef: unknown, args?: Record<string, unknown>) => Promise<unknown>

function withServiceKey<T extends object>(t: T): T {
  return new Proxy(t, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (
        (prop === "query" || prop === "mutation" || prop === "action") &&
        typeof value === "function"
      ) {
        return (fnRef: unknown, args?: Record<string, unknown>) =>
          (value as Fn).call(target, fnRef, { serviceKey: TEST_SERVICE_KEY, ...args })
      }
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

export function setup() {
  return withServiceKey(convexTest(schema, modules))
}

/** A test harness that does NOT inject the service key — for auth tests. */
export function setupWithoutKey() {
  return convexTest(schema, modules)
}
