import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("@kody-ade/backend/api", () => ({
  api: { repoDocs: { get: "repoDocs:get", save: "repoDocs:save" } },
}));

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));

import {
  readRecentWebhookDelivery,
  recordWebhookDelivery,
} from "@dashboard/lib/webhooks/delivery-store";

describe("webhook delivery store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backend.query.mockResolvedValue(null);
    backend.mutation.mockResolvedValue(undefined);
  });

  it("stores only delivery metadata in repository-scoped Convex state", async () => {
    await recordWebhookDelivery({
      owner: "acme",
      repo: "widgets",
      deliveryId: "delivery-1",
      event: "push",
      receivedAt: "2026-08-08T13:00:00.000Z",
    });

    expect(backend.mutation).toHaveBeenCalledWith("repoDocs:save", {
      tenantId: "acme/widgets",
      kind: "webhook-delivery-health",
      doc: {
        version: 1,
        lastReceivedAt: "2026-08-08T13:00:00.000Z",
        deliveryId: "delivery-1",
        event: "push",
      },
      updatedAt: "2026-08-08T13:00:00.000Z",
    });
  });

  it("returns a recent verified delivery", async () => {
    backend.query.mockResolvedValue({
      doc: {
        version: 1,
        lastReceivedAt: "2026-08-08T13:00:00.000Z",
        deliveryId: "delivery-1",
        event: "push",
      },
    });

    await expect(
      readRecentWebhookDelivery("acme", "widgets", {
        now: new Date("2026-08-08T14:00:00.000Z"),
        maxAgeMs: 2 * 60 * 60 * 1000,
      }),
    ).resolves.toEqual({
      lastReceivedAt: "2026-08-08T13:00:00.000Z",
      deliveryId: "delivery-1",
      event: "push",
    });
  });

  it("rejects stale or malformed delivery records", async () => {
    backend.query.mockResolvedValue({
      doc: {
        version: 1,
        lastReceivedAt: "2026-07-01T00:00:00.000Z",
        deliveryId: "delivery-old",
        event: "push",
      },
    });

    await expect(
      readRecentWebhookDelivery("acme", "widgets", {
        now: new Date("2026-08-08T14:00:00.000Z"),
        maxAgeMs: 24 * 60 * 60 * 1000,
      }),
    ).resolves.toBeNull();
  });
});
