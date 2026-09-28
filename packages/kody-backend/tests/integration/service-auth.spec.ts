import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup, setupWithoutKey, TEST_SERVICE_KEY } from "./helpers"

// Protected functions reject calls without a valid serviceKey; the two
// browser-facing queries (chatEvents.since, workflowRuns.list) stay public.

describe("service-key auth", () => {
  it("rejects a protected mutation without a serviceKey", async () => {
    const t = setupWithoutKey()
    await expect(
      t.mutation(api.agents.save, {
        tenantId: "t",
        slug: "kody",
        frontmatter: {},
        body: "Kody",
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/serviceKey/)
  })

  it("rejects a protected query with a wrong serviceKey", async () => {
    const t = setupWithoutKey()
    await expect(
      t.query(api.agents.list, { tenantId: "t", serviceKey: "wrong-key" }),
    ).rejects.toThrow(/serviceKey/)
  })

  it("accepts a protected call with the right serviceKey", async () => {
    const t = setupWithoutKey()
    const agents = await t.query(api.agents.list, {
      tenantId: "t",
      serviceKey: TEST_SERVICE_KEY,
    })
    expect(agents).toEqual([])
  })

  it("never persists the serviceKey on inserted docs", async () => {
    const t = setup()
    await t.mutation(api.actionStates.save, {
      runId: "r1",
      state: { ok: true },
      updatedAt: new Date().toISOString(),
    })
    const doc = await t.query(api.actionStates.get, { runId: "r1" })
    expect(doc).not.toBeNull()
    expect("serviceKey" in (doc as Record<string, unknown>)).toBe(false)
  })

  it("keeps chatEvents.since public (keyless browser subscription)", async () => {
    const t = setup()
    await t.mutation(api.chatEvents.append, {
      tenantId: "global",
      sessionId: "s1",
      event: { ping: true },
    })
    const bare = setupWithoutKey()
    // Same in-memory db is not shared between harnesses, so re-verify on t
    // without a key via a raw call instead.
    const events = await (bare as never as typeof t).query(api.chatEvents.since, {
      tenantId: "global",
      sessionId: "s1",
      afterSeq: -1,
    })
    expect(Array.isArray(events)).toBe(true)
    const eventsWithData = await t.query(api.chatEvents.since, {
      tenantId: "global",
      sessionId: "s1",
      afterSeq: -1,
    })
    expect(eventsWithData).toHaveLength(1)
  })

  it("keeps workflowRuns.list public (keyless browser subscription)", async () => {
    const t = setupWithoutKey()
    const runs = await t.query(api.workflowRuns.list, {
      tenantId: "t",
      workflowId: "w",
    })
    expect(runs).toEqual([])
  })
})
