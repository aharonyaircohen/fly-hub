// Reversible key escaping for Convex payloads.
//
// Convex rejects object keys that start with `$` (reserved at the wire —
// convexToJson throws before any function runs) and `_` (reserved on stored
// documents). Field names must also be non-control ASCII, so non-ASCII escape
// prefixes (e.g. fullwidth ＄) are not an option. Open v.any() payloads (view
// renderer template nodes, chat turns, user state…) legitimately contain such
// keys, so every client-side write escapes them and every read unescapes.
//
// Scheme (ASCII, collision-proof, reversible):
//   - a key starting with `$`, `_`, or `~` gets a single `~` prepended
//     ("$text" → "~$text", "_x" → "~_x", "~a" → "~~a")
//   - unescape strips exactly one leading `~`
// Escaped keys always start with `~`, and unescaped keys that started with
// `~` were themselves escaped, so escape∘unescape is the identity for any
// input and distinct keys never collide.

export const ESCAPE_CHAR = "~"

const NEEDS_ESCAPE = /^[$_~]/

/** Escapes one object key so it is storable as a Convex field name. */
export function escapeKey(key: string): string {
  return NEEDS_ESCAPE.test(key) ? `${ESCAPE_CHAR}${key}` : key
}

/** Reverses {@link escapeKey}. */
export function unescapeKey(key: string): string {
  return key.startsWith(ESCAPE_CHAR) ? key.slice(1) : key
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function deepMapKeys(value: unknown, mapKey: (key: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepMapKeys(item, mapKey))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [mapKey(key), deepMapKeys(item, mapKey)]),
    )
  }
  return value
}

/**
 * Deeply escapes every reserved-prefix key (nested objects and arrays) so the
 * value round-trips through Convex. Non-plain objects (Dates, class
 * instances, ArrayBuffers) are passed through untouched.
 */
export function deepEscapeKeys<T>(value: T): T {
  return deepMapKeys(value, escapeKey) as T
}

/** Reverses {@link deepEscapeKeys} — reads return the caller's original keys. */
export function deepUnescapeKeys<T>(value: T): T {
  return deepMapKeys(value, unescapeKey) as T
}
