import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const NOW = "2026-07-15T00:00:00.000Z"

describe("repoDocs", () => {
  it("saves and upserts singleton docs by kind", async () => {
    const t = setup()
    await t.mutation(api.repoDocs.save, {
      tenantId: TENANT,
      kind: "dashboard-config",
      doc: { version: 1 },
      updatedAt: NOW,
    })
    await t.mutation(api.repoDocs.save, {
      tenantId: TENANT,
      kind: "dashboard-config",
      doc: { version: 1, defaultPreviewUrl: "http://x" },
      updatedAt: NOW,
    })
    const doc = await t.query(api.repoDocs.get, { tenantId: TENANT, kind: "dashboard-config" })
    expect(doc?.doc.defaultPreviewUrl).toBe("http://x")
  })

  it("returns null for a kind that was never saved", async () => {
    const t = setup()
    expect(await t.query(api.repoDocs.get, { tenantId: TENANT, kind: "system-prompt" })).toBeNull()
  })
})
