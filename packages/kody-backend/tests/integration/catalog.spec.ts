import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

describe("catalog projection", () => {
  it("keeps legacy goal-template rows deployable and queryable", async () => {
    const t = setup()
    await t.mutation(api.catalog.save, {
      tenantId: "acme/app",
      category: "goal-template",
      slug: "quality",
      doc: { name: "Quality" },
      source: "store",
      updatedAt: "2026-08-02T00:00:00.000Z",
    })

    const entries = await t.query(api.catalog.list, {
      tenantId: "acme/app",
      category: "goal-template",
    })
    expect(entries.map((entry) => entry.slug)).toEqual(["quality"])
  })

  it("upserts and lists projected repository assets by category", async () => {
    const t = setup();
    await t.mutation(api.catalog.save, {
      tenantId: "acme/app",
      category: "capability",
      slug: "ci-health",
      doc: { slug: "ci-health", describe: "CI health" },
      source: "backend",
      updatedAt: "2026-07-15T00:00:00.000Z",
    });
    await t.mutation(api.catalog.save, {
      tenantId: "acme/app",
      category: "capability",
      slug: "ci-health",
      doc: { slug: "ci-health", describe: "Updated" },
      source: "backend",
      updatedAt: "2026-07-15T00:01:00.000Z",
    });
    const entries = await t.query(api.catalog.list, {
      tenantId: "acme/app",
      category: "capability",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].doc.describe).toBe("Updated");
  });
});
