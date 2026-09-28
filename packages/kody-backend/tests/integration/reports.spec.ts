import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const NOW = "2026-07-15T00:00:00.000Z"

describe("reports", () => {
  it("keeps top-level reports and run reports separate", async () => {
    const t = setup()
    await t.mutation(api.reports.save, {
      tenantId: TENANT,
      slug: "weekly",
      body: "top",
      meta: {},
      updatedAt: NOW,
    })
    await t.mutation(api.reports.save, {
      tenantId: TENANT,
      slug: "weekly",
      runId: "r1",
      body: "run body",
      meta: {},
      updatedAt: NOW,
    })
    await t.mutation(api.reports.save, {
      tenantId: TENANT,
      slug: "weekly",
      body: "top v2",
      meta: {},
      updatedAt: NOW,
    })

    const reports = await t.query(api.reports.list, { tenantId: TENANT })
    expect(reports).toHaveLength(2)
    const top = reports.find((r) => r.runId === undefined)
    expect(top?.body).toBe("top v2")
  })
})
