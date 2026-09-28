import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const NOW = "2026-07-15T00:00:00.000Z"

describe("agencyRecords", () => {
  it("saves, upserts, and lists records per kind", async () => {
    const t = setup()
    await t.mutation(api.agencyRecords.save, {
      tenantId: TENANT,
      kind: "observation",
      recordId: "obs-1",
      doc: { v: 1 },
      updatedAt: NOW,
    })
    await t.mutation(api.agencyRecords.save, {
      tenantId: TENANT,
      kind: "observation",
      recordId: "obs-1",
      doc: { v: 2 },
      updatedAt: NOW,
    })
    await t.mutation(api.agencyRecords.save, {
      tenantId: TENANT,
      kind: "finding",
      recordId: "f1",
      doc: {},
      updatedAt: NOW,
    })

    const obs = await t.query(api.agencyRecords.list, { tenantId: TENANT, kind: "observation" })
    expect(obs).toHaveLength(1)
    expect(obs[0].doc.v).toBe(2)
  })

  it("rejects unknown kinds", async () => {
    const t = setup()
    await expect(
      t.mutation(api.agencyRecords.save, {
        tenantId: TENANT,
        kind: "rumor",
        recordId: "r1",
        doc: {},
        updatedAt: NOW,
      }),
    ).rejects.toThrow()
  })
})
