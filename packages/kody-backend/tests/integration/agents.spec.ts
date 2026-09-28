import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const NOW = "2026-07-15T00:00:00.000Z"

describe("agents", () => {
  it("saves and upserts agents", async () => {
    const t = setup()
    await t.mutation(api.agents.save, {
      tenantId: TENANT,
      slug: "helper",
      frontmatter: { model: "a" },
      body: "v1",
      updatedAt: NOW,
    })
    await t.mutation(api.agents.save, {
      tenantId: TENANT,
      slug: "helper",
      frontmatter: { model: "b" },
      body: "v2",
      updatedAt: NOW,
    })
    const agents = await t.query(api.agents.list, { tenantId: TENANT })
    expect(agents).toHaveLength(1)
    expect(agents[0].body).toBe("v2")
    expect(agents[0].frontmatter.model).toBe("b")
  })
})
