import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ConvexHttpClient } from "convex/browser"
import { withEscapedKeys } from "../../src/client"

// Pin the service-key env so behavior is deterministic regardless of the
// shell env the suite runs in.
beforeEach(() => vi.stubEnv("KODY_SERVICE_KEY", ""))
afterEach(() => vi.unstubAllEnvs())

function stubClient(result: unknown) {
  const calls: Array<{ method: string; fn: unknown; args: unknown }> = []
  const make = (method: string) =>
    vi.fn(async (fn: unknown, args?: unknown) => {
      calls.push({ method, fn, args })
      return result
    })
  const client = {
    query: make("query"),
    mutation: make("mutation"),
    action: make("action"),
    setAuth: vi.fn(),
  }
  return { client: client as unknown as ConvexHttpClient, calls }
}

describe("withEscapedKeys", () => {
  it("escapes mutation args deeply before they hit the wire", async () => {
    const { client, calls } = stubClient(null)
    const wrapped = withEscapedKeys(client)
    await wrapped.mutation("fn" as never, {
      tenantId: "acme/app",
      definition: { $text: "hi", nodes: [{ _k: 1 }] },
    } as never)
    expect(calls[0].args).toEqual({
      tenantId: "acme/app",
      definition: { "~$text": "hi", nodes: [{ "~_k": 1 }] },
    })
  })

  it("unescapes query results deeply", async () => {
    const { client } = stubClient([
      { _id: "1", _creationTime: 2, definition: { "~$text": "hi", "~~raw": true } },
    ])
    const wrapped = withEscapedKeys(client)
    const result = await wrapped.query("fn" as never, { tenantId: "t" } as never)
    // System fields (_id, _creationTime) are untouched; escaped keys revert.
    expect(result).toEqual([
      { _id: "1", _creationTime: 2, definition: { $text: "hi", "~raw": true } },
    ])
  })

  it("passes undefined args through and still unescapes the result", async () => {
    const { client, calls } = stubClient({ "~$ok": 1 })
    const wrapped = withEscapedKeys(client)
    const result = await wrapped.query("fn" as never)
    expect(calls[0].args).toBeUndefined()
    expect(result).toEqual({ $ok: 1 })
  })

  it("injects KODY_SERVICE_KEY into args when the env var is set", async () => {
    vi.stubEnv("KODY_SERVICE_KEY", "secret-1")
    const { client, calls } = stubClient(null)
    const wrapped = withEscapedKeys(client)
    await wrapped.mutation("fn" as never, { tenantId: "t" } as never)
    await wrapped.query("fn" as never)
    expect(calls[0].args).toEqual({ tenantId: "t", serviceKey: "secret-1" })
    expect(calls[1].args).toEqual({ serviceKey: "secret-1" })
  })

  it("delegates non-call members to the underlying client", () => {
    const { client } = stubClient(null)
    const wrapped = withEscapedKeys(client)
    wrapped.setAuth("token")
    expect((client as unknown as { setAuth: ReturnType<typeof vi.fn> }).setAuth).toHaveBeenCalledWith("token")
  })
})
