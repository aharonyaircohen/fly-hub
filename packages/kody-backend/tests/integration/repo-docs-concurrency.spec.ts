import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

describe("repoDocs concurrency", () => {
  it("rejects stale updates and bounds prefix reads", async () => {
    const t = setup();
    await t.mutation(api.repoDocs.save, {
      tenantId: "acme/app",
      kind: "context:one",
      doc: { value: 1 },
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    await expect(
      t.mutation(api.repoDocs.save, {
        tenantId: "acme/app",
        kind: "context:one",
        doc: { value: 2 },
        updatedAt: "2026-07-17T00:01:00.000Z",
        expectedUpdatedAt: "stale",
      }),
    ).rejects.toThrow("Repository document changed since it was read");
    await expect(
      t.query(api.repoDocs.listByPrefix, {
        tenantId: "acme/app",
        prefix: "context:",
      }),
    ).resolves.toHaveLength(1);
  });

  it("rejects a create that expected the document to be absent", async () => {
    const t = setup();
    await t.mutation(api.repoDocs.save, {
      tenantId: "acme/app",
      kind: "secrets.enc",
      doc: { value: 1 },
      updatedAt: "2026-08-07T00:00:00.000Z",
      expectedUpdatedAt: null,
    });

    await expect(
      t.mutation(api.repoDocs.save, {
        tenantId: "acme/app",
        kind: "secrets.enc",
        doc: { value: 2 },
        updatedAt: "2026-08-07T00:01:00.000Z",
        expectedUpdatedAt: null,
      }),
    ).rejects.toThrow("Repository document changed since it was read");
  });
});
