import { describe, expect, it } from "vitest"
import {
  deepEscapeKeys,
  deepUnescapeKeys,
  escapeKey,
  unescapeKey,
} from "../../src/escape-keys"

describe("escapeKey / unescapeKey", () => {
  it("escapes $-prefixed keys", () => {
    expect(escapeKey("$text")).toBe("~$text")
    expect(escapeKey("$")).toBe("~$")
  })

  it("escapes _-prefixed keys", () => {
    expect(escapeKey("_x")).toBe("~_x")
    expect(escapeKey("_id")).toBe("~_id")
  })

  it("escapes ~-prefixed keys by doubling (collision-proof)", () => {
    expect(escapeKey("~a")).toBe("~~a")
    expect(escapeKey("~$text")).toBe("~~$text")
    expect(escapeKey("~~")).toBe("~~~")
  })

  it("leaves ordinary keys untouched", () => {
    for (const key of ["text", "a$b", "x_", "", "kind", "value.$x"]) {
      expect(escapeKey(key)).toBe(key)
    }
  })

  it("unescape reverses escape for every prefix class", () => {
    for (const key of ["$text", "_x", "~a", "~~b", "~$c", "plain", "", "$", "_", "~"]) {
      expect(unescapeKey(escapeKey(key))).toBe(key)
    }
  })

  it("distinct keys never collide after escaping", () => {
    const keys = ["$text", "~$text", "~~$text", "_x", "~_x", "text", "~text"]
    const escaped = keys.map(escapeKey)
    expect(new Set(escaped).size).toBe(keys.length)
    expect(escaped.map(unescapeKey)).toEqual(keys)
  })
})

describe("deepEscapeKeys / deepUnescapeKeys", () => {
  it("escapes nested object keys at every depth", () => {
    const input = { a: { $text: { _deep: 1, ok: 2 } }, $top: true }
    expect(deepEscapeKeys(input)).toEqual({
      a: { "~$text": { "~_deep": 1, ok: 2 } },
      "~$top": true,
    })
  })

  it("recurses into arrays (including arrays of arrays)", () => {
    const input = { list: [{ $a: 1 }, [{ _b: 2 }], "s", 3, null] }
    expect(deepEscapeKeys(input)).toEqual({
      list: [{ "~$a": 1 }, [{ "~_b": 2 }], "s", 3, null],
    })
  })

  it("round-trips a gnarly payload exactly (escape then unescape)", () => {
    const input = {
      $text: "hi",
      _meta: { "~already": [{ $nested: { "~~double": null } }] },
      normal: [1, "two", true, null, { $x: [{ _y: "~z" }] }],
    }
    expect(deepUnescapeKeys(deepEscapeKeys(input))).toEqual(input)
  })

  it("escape is idempotent-safe under round-trip on pre-escaped-looking data", () => {
    // Keys that already look escaped ("~$a") still round-trip — they get
    // another ~ on escape and lose exactly one on unescape.
    const input = { "~$a": 1, "~~b": { "~_c": 2 } }
    expect(deepUnescapeKeys(deepEscapeKeys(input))).toEqual(input)
  })

  it("passes primitives and non-plain objects through untouched", () => {
    expect(deepEscapeKeys(null)).toBeNull()
    expect(deepEscapeKeys(42)).toBe(42)
    expect(deepEscapeKeys("$text")).toBe("$text")
    const buf = new ArrayBuffer(4)
    expect(deepEscapeKeys({ buf }).buf).toBe(buf)
  })

  it("does not mutate the input", () => {
    const input = { $a: { _b: [1, { $c: 2 }] } }
    const snapshot = JSON.parse(JSON.stringify(input))
    deepEscapeKeys(input)
    expect(input).toEqual(snapshot)
  })

  it("leaves already-clean values structurally identical", () => {
    const input = { kind: "view", children: [{ tag: "div", props: { id: "x" } }] }
    expect(deepEscapeKeys(input)).toEqual(input)
    expect(deepUnescapeKeys(input)).toEqual(input)
  })
})
