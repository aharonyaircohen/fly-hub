import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const NOW = "2026-07-15T00:00:00.000Z"

describe("capabilityState", () => {
  it("saves and upserts state per capability", async () => {
    const t = setup()
    await t.mutation(api.capabilityState.save, {
      tenantId: TENANT,
      slug: "dev-ci",
      state: { healthy: false },
      updatedAt: NOW,
    })
    await t.mutation(api.capabilityState.save, {
      tenantId: TENANT,
      slug: "dev-ci",
      state: { healthy: true },
      updatedAt: NOW,
    })
    const state = await t.query(api.capabilityState.get, { tenantId: TENANT, slug: "dev-ci" })
    expect(state?.state.healthy).toBe(true)
  })
})
