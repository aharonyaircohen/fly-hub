import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/app";
const NOW = "2026-07-15T00:00:00.000Z";

describe("viewRenderers", () => {
  it("keeps immutable renderer versions and resolves an exact version", async () => {
    const t = setup();
    const firstVersion = await t.mutation(api.viewRenderers.save, {
      tenantId: TENANT,
      slug: "question-select",
      definition: { slug: "question-select", name: "Question v1" },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const secondVersion = await t.mutation(api.viewRenderers.save, {
      tenantId: TENANT,
      slug: "question-select",
      definition: { slug: "question-select", name: "Question v2" },
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(firstVersion).toBe(1);
    expect(secondVersion).toBe(2);
    expect(
      await t.query(api.viewRenderers.getVersion, {
        tenantId: TENANT,
        slug: "question-select",
        version: 1,
      }),
    ).toMatchObject({
      version: 1,
      definition: { name: "Question v1" },
    });
    expect(
      await t.query(api.viewRenderers.list, { tenantId: TENANT }),
    ).toMatchObject([
      {
        slug: "question-select",
        version: 2,
        definition: { name: "Question v2" },
      },
    ]);
  });

  it("saves and upserts view renderers", async () => {
    const t = setup();
    await t.mutation(api.viewRenderers.save, {
      tenantId: TENANT,
      slug: "card",
      definition: { v: 1 },
      updatedAt: NOW,
    });
    await t.mutation(api.viewRenderers.save, {
      tenantId: TENANT,
      slug: "card",
      definition: { v: 2 },
      updatedAt: NOW,
    });
    const renderers = await t.query(api.viewRenderers.list, {
      tenantId: TENANT,
    });
    expect(renderers).toHaveLength(1);
    expect(renderers[0].definition.v).toBe(2);
  });
});
