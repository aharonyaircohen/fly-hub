import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const NOW = "2026-07-15T00:00:00.000Z"

describe("actionStates", () => {
  it("saves and upserts action state per run", async () => {
    const t = setup()
    await t.mutation(api.actionStates.save, {
      runId: "run1",
      state: { status: "running" },
      updatedAt: NOW,
    })
    await t.mutation(api.actionStates.save, {
      runId: "run1",
      state: { status: "done" },
      updatedAt: NOW,
    })
    const state = await t.query(api.actionStates.get, { runId: "run1" })
    expect(state?.state.status).toBe("done")
  })

  it("returns null for an unknown run", async () => {
    const t = setup()
    expect(await t.query(api.actionStates.get, { runId: "nope" })).toBeNull()
  })
})

describe("actionStates list/remove", () => {
  it("lists all saved states", async () => {
    const t = setup()
    await t.mutation(api.actionStates.save, { runId: "a", state: { s: 1 }, updatedAt: NOW })
    await t.mutation(api.actionStates.save, { runId: "b", state: { s: 2 }, updatedAt: NOW })
    const all = await t.query(api.actionStates.list, {})
    expect(all.map((d: { runId: string }) => d.runId).sort()).toEqual(["a", "b"])
  })

  it("removes a state and reports missing runs", async () => {
    const t = setup()
    await t.mutation(api.actionStates.save, { runId: "a", state: { s: 1 }, updatedAt: NOW })
    expect(await t.mutation(api.actionStates.remove, { runId: "a" })).toBe(true)
    expect(await t.mutation(api.actionStates.remove, { runId: "a" })).toBe(false)
    expect(await t.query(api.actionStates.get, { runId: "a" })).toBeNull()
  })
})
