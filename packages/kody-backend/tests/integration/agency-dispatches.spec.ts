import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/app";
const NOW = "2026-08-08T05:00:00.000Z";

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    idempotencyKey: "ci-repair:manual:first",
    loopId: "ci-repair",
    decision: { kind: "fire" as const, reason: "manual Loop run requested" },
    leaseUntil: "2026-08-08T05:10:00.000Z",
    reservationId: "reservation-first",
    correlationId: "correlation-first",
    policyHash: "loop:ci-repair",
    effectivePolicy: { source: "repository" },
    definitionRefs: [{ kind: "loop", id: "ci-repair" }],
    maxConcurrentRuns: 1,
    requiresApproval: false,
    approvalScopeKind: "loop" as const,
    approvalScopeId: "ci-repair",
    approvalAction: "workflow:ci-repair",
    now: NOW,
    ...overrides,
  };
}

describe("agency dispatch leases", () => {
  it("renews only the active reservation holder", async () => {
    const t = setup();
    await t.mutation(api.agencyModel.reserveDispatch, reservation());

    await expect(
      t.mutation(api.agencyModel.renewDispatch, {
        tenantId: TENANT,
        idempotencyKey: "ci-repair:manual:first",
        reservationId: "reservation-first",
        leaseUntil: "2026-08-08T05:11:00.000Z",
        now: "2026-08-08T05:01:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.agencyModel.renewDispatch, {
        tenantId: TENANT,
        idempotencyKey: "ci-repair:manual:first",
        reservationId: "reservation-wrong",
        leaseUntil: "2026-08-08T05:12:00.000Z",
        now: "2026-08-08T05:02:00.000Z",
      }),
    ).rejects.toThrow("reservation is stale");
  });

  it("does not let a legacy six-hour lease block a new dispatch", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("agencyDispatches", {
        tenantId: TENANT,
        idempotencyKey: "ci-repair:manual:legacy",
        loopId: "ci-repair",
        decision: { kind: "fire", reason: "legacy manual run" },
        status: "reserved",
        leaseUntil: "2026-08-08T11:00:00.000Z",
        reservationId: "reservation-legacy",
        correlationId: "correlation-legacy",
        policyHash: "loop:ci-repair",
        effectivePolicy: { source: "repository" },
        definitionRefs: [{ kind: "loop", id: "ci-repair" }],
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    await expect(
      t.mutation(
        api.agencyModel.reserveDispatch,
        reservation({
          idempotencyKey: "ci-repair:manual:second",
          reservationId: "reservation-second",
          correlationId: "correlation-second",
        }),
      ),
    ).resolves.toMatchObject({ acquired: true });
  });

  it("rejects new leases beyond the bounded recovery window", async () => {
    const t = setup();

    await expect(
      t.mutation(
        api.agencyModel.reserveDispatch,
        reservation({ leaseUntil: "2026-08-08T05:16:00.000Z" }),
      ),
    ).rejects.toThrow("lease is invalid");
  });
});
