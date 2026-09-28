import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

describe("manifests", () => {
  it("stores one typed document per tenant and rejects stale writes", async () => {
    const t = setup()
    await t.mutation(api.manifests.save, {
      tenantId: "acme/app",
      kind: "trust",
      doc: { version: 1 },
      updatedAt: "v1",
    })
    await expect(t.mutation(api.manifests.save, {
      tenantId: "acme/app",
      kind: "trust",
      doc: { version: 2 },
      updatedAt: "v2",
      expectedUpdatedAt: "stale",
    })).rejects.toThrow("Manifest changed since it was read")

    const stored = await t.query(api.manifests.get, {
      tenantId: "acme/app",
      kind: "trust",
    })
    expect(stored).toMatchObject({ doc: { version: 1 }, updatedAt: "v1" })
  })
})
