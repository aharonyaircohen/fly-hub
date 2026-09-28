import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const NOW = "2026-07-15T00:00:00.000Z"

describe("notificationPrefs", () => {
  it("saves and upserts prefs per login", async () => {
    const t = setup()
    await t.mutation(api.notificationPrefs.save, {
      tenantId: TENANT,
      login: "octocat",
      prefs: { muted: [] },
      updatedAt: NOW,
    })
    await t.mutation(api.notificationPrefs.save, {
      tenantId: TENANT,
      login: "octocat",
      prefs: { muted: ["ci"] },
      updatedAt: NOW,
    })
    const prefs = await t.query(api.notificationPrefs.get, { tenantId: TENANT, login: "octocat" })
    expect(prefs?.prefs.muted).toEqual(["ci"])
  })
})
