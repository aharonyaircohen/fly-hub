import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const base = { tenantId: "acme/app", workflowId: "release", runId: "run-1" };

describe("workflow run leases", () => {
  it("allows only one owner until the lease expires", async () => {
    const t = setup();
    await expect(
      t.mutation(api.workflowRunLeases.acquire, {
        ...base,
        ownerId: "a",
        nowMs: 1_000,
        leaseDurationMs: 10_000,
      }),
    ).resolves.toMatchObject({ acquired: true, expiresAtMs: 11_000 });
    await expect(
      t.mutation(api.workflowRunLeases.acquire, {
        ...base,
        ownerId: "b",
        nowMs: 2_000,
        leaseDurationMs: 10_000,
      }),
    ).resolves.toMatchObject({ acquired: false, ownerId: "a" });
    await expect(
      t.mutation(api.workflowRunLeases.acquire, {
        ...base,
        ownerId: "b",
        nowMs: 12_000,
        leaseDurationMs: 10_000,
      }),
    ).resolves.toMatchObject({ acquired: true, expiresAtMs: 22_000 });
  });

  it("renews and releases only for the current owner", async () => {
    const t = setup();
    await t.mutation(api.workflowRunLeases.acquire, {
      ...base,
      ownerId: "a",
      nowMs: 1_000,
      leaseDurationMs: 10_000,
    });
    await expect(
      t.mutation(api.workflowRunLeases.renew, {
        ...base,
        ownerId: "b",
        nowMs: 2_000,
        leaseDurationMs: 10_000,
      }),
    ).resolves.toBe(false);
    await expect(
      t.mutation(api.workflowRunLeases.renew, {
        ...base,
        ownerId: "a",
        nowMs: 2_000,
        leaseDurationMs: 10_000,
      }),
    ).resolves.toBe(true);
    await expect(
      t.mutation(api.workflowRunLeases.release, { ...base, ownerId: "b" }),
    ).resolves.toBe(false);
    await expect(
      t.mutation(api.workflowRunLeases.release, { ...base, ownerId: "a" }),
    ).resolves.toBe(true);
  });
});
