import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/studio"
const VERIFIED_AT = "2026-08-31T12:00:00.000Z"

const connection = {
  id: "facebook-main",
  name: "Yair Facebook Page",
  provider: "facebook",
  accountType: "page",
  externalId: "123456789",
  credentialRefs: { accessToken: "FACEBOOK_PAGE_ACCESS_TOKEN" },
  status: "connected" as const,
  verifiedAt: VERIFIED_AT,
}

describe("connections", () => {
  it("stores the agreed Connection structure per repository", async () => {
    const t = setup()
    await t.mutation(api.connections.save, {
      tenantId: TENANT,
      connection,
    })
    await t.mutation(api.connections.save, {
      tenantId: "other/repo",
      connection: { ...connection, name: "Other Page" },
    })

    const list = await t.query(api.connections.list, { tenantId: TENANT })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject(connection)
    expect(JSON.stringify(list[0])).not.toContain("secret-value")
  })

  it("upserts by immutable Connection id", async () => {
    const t = setup()
    await t.mutation(api.connections.save, { tenantId: TENANT, connection })
    await t.mutation(api.connections.save, {
      tenantId: TENANT,
      connection: { ...connection, name: "Renamed Page" },
    })

    const list = await t.query(api.connections.list, { tenantId: TENANT })
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe("Renamed Page")
  })

  it("rejects credential values and unknown model fields", async () => {
    const t = setup()
    await expect(
      t.mutation(api.connections.save, {
        tenantId: TENANT,
        connection: {
          ...connection,
          accessToken: "secret-value",
        },
      }),
    ).rejects.toThrow()
  })
})
