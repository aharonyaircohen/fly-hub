import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const OTHER_TENANT = "other/app"

const initialState = {
  version: 1 as const,
  agent: "operations-agent",
  revision: 0,
  cursor: "",
  summary: "",
  data: {},
  updatedAt: "2026-08-19T00:00:00.000Z",
}

describe("agentStates", () => {
  it("persists Agent-owned continuation independently per tenant", async () => {
    const t = setup()
    await t.mutation(api.agentStates.save, {
      tenantId: TENANT,
      state: initialState,
    })

    expect(
      await t.query(api.agentStates.get, {
        tenantId: TENANT,
        agent: "operations-agent",
      }),
    ).toMatchObject({ state: initialState })
    expect(
      await t.query(api.agentStates.get, {
        tenantId: OTHER_TENANT,
        agent: "operations-agent",
      }),
    ).toBeNull()
  })

  it("rejects stale revisions and can reset state", async () => {
    const t = setup()
    await t.mutation(api.agentStates.save, {
      tenantId: TENANT,
      state: initialState,
    })

    await t.mutation(api.agentStates.save, {
      tenantId: TENANT,
      expectedRevision: 0,
      state: {
        ...initialState,
        revision: 1,
        cursor: "run-1",
        summary: "First cycle finished.",
        updatedAt: "2026-08-19T01:00:00.000Z",
      },
    })

    await expect(
      t.mutation(api.agentStates.save, {
        tenantId: TENANT,
        expectedRevision: 0,
        state: { ...initialState, revision: 1 },
      }),
    ).rejects.toThrow("Agent state changed since it was read")

    await t.mutation(api.agentStates.reset, {
      tenantId: TENANT,
      agent: "operations-agent",
    })
    expect(
      await t.query(api.agentStates.get, {
        tenantId: TENANT,
        agent: "operations-agent",
      }),
    ).toBeNull()
  })
})
