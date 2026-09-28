import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

describe("eventLog", () => {
  it("appends events and filters by run", async () => {
    const t = setup()
    for (const [i, runId] of [
      [1, "a"],
      [2, "b"],
      [3, "a"],
    ] as const) {
      await t.mutation(api.eventLog.append, {
        entryId: `e${i}`,
        runId,
        event: "step",
        payload: { i },
        emittedAt: `2026-07-15T00:00:0${i}.000Z`,
      })
    }
    const forA = await t.query(api.eventLog.forRun, { runId: "a" })
    expect(forA.map((e) => e.entryId)).toEqual(["e1", "e3"])
  })

  it("returns recent events newest-first with a bounded limit", async () => {
    const t = setup()
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.eventLog.append, {
        entryId: `e${i}`,
        runId: "r",
        event: "tick",
        payload: {},
        emittedAt: `2026-07-15T00:00:0${i}.000Z`,
      })
    }
    const recent = await t.query(api.eventLog.recent, { limit: 3 })
    expect(recent).toHaveLength(3)
    expect(recent[0].entryId).toBe("e4")
  })
})
