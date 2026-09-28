import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const NOW = "2026-07-15T00:00:00.000Z"

describe("channelsSeen", () => {
  it("saves and upserts manifests per login", async () => {
    const t = setup()
    await t.mutation(api.channelsSeen.save, {
      tenantId: TENANT,
      login: "octocat",
      manifest: { version: 1, seen: {} },
      updatedAt: NOW,
    })
    await t.mutation(api.channelsSeen.save, {
      tenantId: TENANT,
      login: "octocat",
      manifest: { version: 1, seen: { "1": NOW } },
      updatedAt: NOW,
    })
    const seen = await t.query(api.channelsSeen.get, { tenantId: TENANT, login: "octocat" })
    expect(seen?.manifest.seen["1"]).toBe(NOW)
  })
})
