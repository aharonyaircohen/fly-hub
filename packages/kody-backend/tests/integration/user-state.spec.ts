import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const NOW = "2026-07-15T00:00:00.000Z"

describe("userState", () => {
  it("saves and upserts user-state per namespace and user", async () => {
    const t = setup()
    await t.mutation(api.userState.save, {
      tenantId: TENANT,
      namespace: "profile",
      userKey: "u1",
      data: { name: "A" },
      updatedAt: NOW,
    })
    await t.mutation(api.userState.save, {
      tenantId: TENANT,
      namespace: "profile",
      userKey: "u1",
      data: { name: "B" },
      updatedAt: NOW,
    })
    await t.mutation(api.userState.save, {
      tenantId: TENANT,
      namespace: "stats",
      userKey: "u1",
      data: { count: 1 },
      updatedAt: NOW,
    })

    const profile = await t.query(api.userState.get, {
      tenantId: TENANT,
      namespace: "profile",
      userKey: "u1",
    })
    expect(profile?.data.name).toBe("B")
  })

  it("returns null for an unknown user", async () => {
    const t = setup()
    expect(
      await t.query(api.userState.get, { tenantId: TENANT, namespace: "profile", userKey: "u2" }),
    ).toBeNull()
  })

  it("rejects a save whose expectedUpdatedAt is stale", async () => {
    const t = setup()
    const base = { tenantId: TENANT, namespace: "profile", userKey: "cas" }
    await t.mutation(api.userState.save, { ...base, data: { name: "A" }, updatedAt: "t-1" })
    await t.mutation(api.userState.save, { ...base, data: { name: "B" }, updatedAt: "t-2" })

    await expect(
      t.mutation(api.userState.save, {
        ...base,
        data: { name: "C" },
        updatedAt: "t-3",
        expectedUpdatedAt: "t-1",
      }),
    ).rejects.toThrow(/changed since it was read/)

    await t.mutation(api.userState.save, {
      ...base,
      data: { name: "C" },
      updatedAt: "t-3",
      expectedUpdatedAt: "t-2",
    })
    const row = await t.query(api.userState.get, { ...base })
    expect(row?.data.name).toBe("C")
  })

  it("rejects a must-not-exist save when the row already exists", async () => {
    const t = setup()
    const base = { tenantId: TENANT, namespace: "profile", userKey: "cas-new" }
    await t.mutation(api.userState.save, {
      ...base,
      data: { name: "new" },
      updatedAt: "t-1",
      expectedUpdatedAt: null,
    })
    await expect(
      t.mutation(api.userState.save, {
        ...base,
        data: { name: "clobber" },
        updatedAt: "t-2",
        expectedUpdatedAt: null,
      }),
    ).rejects.toThrow(/changed since it was read/)
  })
})
