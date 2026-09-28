import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

describe("blueprint installations", () => {
  it("stores and reads repository-scoped Blueprint status", async () => {
    const t = setup();
    await t.mutation(api.blueprintInstallations.save, {
      tenantId: "aharonyaircohen/kody-chat",
      blueprintId: "healthy-ci",
      blueprintVersion: "1.0.0",
      status: "active",
      requestId: "build-healthy-ci",
      maintainerId: "ci-repair",
      evidence: ["CI passes"],
      updatedAt: "2026-08-18T00:00:00.000Z",
    });

    await expect(
      t.query(api.blueprintInstallations.get, {
        tenantId: "aharonyaircohen/kody-chat",
        blueprintId: "healthy-ci",
      }),
    ).resolves.toMatchObject({
      blueprintId: "healthy-ci",
      status: "active",
      maintainerId: "ci-repair",
    });
  });
});
