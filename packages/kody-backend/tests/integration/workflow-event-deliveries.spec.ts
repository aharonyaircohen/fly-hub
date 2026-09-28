import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const base = {
  tenantId: "acme/shop",
  deliveryId: "delivery-1",
  triggerId: "ci-repair-on-failure",
  workflowId: "ci-repair",
  eventName: "github.workflow_run.completed",
  requestId: "github-request-1",
  sourceEventId: "github.workflow_run.completed:42",
  sourceUrl: "https://github.com/acme/shop/actions/runs/42",
  input: { sourceRunId: 42 },
};

describe("workflow event deliveries", () => {
  it("claims a delivery once and records dispatch completion", async () => {
    const t = setup();
    const first = await t.mutation(api.workflowEventDeliveries.reserve, {
      ...base,
      now: "2026-08-04T07:00:00.000Z",
    });
    const replay = await t.mutation(api.workflowEventDeliveries.reserve, {
      ...base,
      now: "2026-08-04T07:01:00.000Z",
    });

    expect(first).toEqual({ claimed: true, status: "pending" });
    expect(replay).toEqual({ claimed: false, status: "pending" });

    await expect(
      t.mutation(api.workflowEventDeliveries.markDispatched, {
        tenantId: base.tenantId,
        deliveryId: base.deliveryId,
        triggerId: base.triggerId,
        now: "2026-08-04T07:02:00.000Z",
      }),
    ).resolves.toBe(true);

    const after = await t.mutation(api.workflowEventDeliveries.reserve, {
      ...base,
      now: "2026-08-04T07:03:00.000Z",
    });
    expect(after).toEqual({ claimed: false, status: "dispatched" });
  });

  it("allows a failed delivery to be retried", async () => {
    const t = setup();
    await t.mutation(api.workflowEventDeliveries.reserve, {
      ...base,
      now: "2026-08-04T07:00:00.000Z",
    });
    await t.mutation(api.workflowEventDeliveries.markFailed, {
      tenantId: base.tenantId,
      deliveryId: base.deliveryId,
      triggerId: base.triggerId,
      error: "Actions API unavailable",
      now: "2026-08-04T07:01:00.000Z",
    });

    await expect(
      t.mutation(api.workflowEventDeliveries.reserve, {
        ...base,
        now: "2026-08-04T07:02:00.000Z",
      }),
    ).resolves.toEqual({ claimed: true, status: "pending" });
  });

  it("deduplicates a source run even when GitHub sends a new delivery id", async () => {
    const t = setup();
    await t.mutation(api.workflowEventDeliveries.reserve, {
      ...base,
      now: "2026-08-04T07:00:00.000Z",
    });

    await expect(
      t.mutation(api.workflowEventDeliveries.reserve, {
        ...base,
        deliveryId: "redelivery-2",
        requestId: "github-request-2",
        now: "2026-08-04T07:01:00.000Z",
      }),
    ).resolves.toEqual({ claimed: false, status: "pending" });
  });

  it("returns a safe newest-first read model without event input", async () => {
    const t = setup();
    await t.mutation(api.workflowEventDeliveries.reserve, {
      ...base,
      now: "2026-08-04T07:00:00.000Z",
    });
    await t.mutation(api.workflowEventDeliveries.markFailed, {
      tenantId: base.tenantId,
      deliveryId: base.deliveryId,
      triggerId: base.triggerId,
      error: "Actions API unavailable",
      now: "2026-08-04T07:01:00.000Z",
    });

    const rows = await t.query(api.workflowEventDeliveries.recent, {
      tenantId: base.tenantId,
      limit: 10,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        deliveryId: base.deliveryId,
        sourceUrl: base.sourceUrl,
        status: "failed",
        error: "Actions API unavailable",
      }),
    ]);
    expect(rows[0]).not.toHaveProperty("input");
  });
});
