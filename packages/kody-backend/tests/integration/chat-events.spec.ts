import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"

describe("chatEvents", () => {
  it("streams events after a given seq", async () => {
    const t = setup()
    for (const n of [1, 2, 3]) {
      await t.mutation(api.chatEvents.append, {
        tenantId: TENANT,
        sessionId: "s1",
        event: { n },
      })
    }
    const tail = await t.query(api.chatEvents.since, {
      tenantId: TENANT,
      sessionId: "s1",
      afterSeq: 0,
    })
    expect(tail.map((e) => e.event.n)).toEqual([2, 3])
  })

  it("keeps event seqs independent per session", async () => {
    const t = setup()
    await t.mutation(api.chatEvents.append, { tenantId: TENANT, sessionId: "a", event: {} })
    await t.mutation(api.chatEvents.append, { tenantId: TENANT, sessionId: "b", event: {} })
    const a = await t.query(api.chatEvents.since, {
      tenantId: TENANT,
      sessionId: "a",
      afterSeq: -1,
    })
    expect(a).toHaveLength(1)
    expect(a[0].seq).toBe(0)
  })
})
