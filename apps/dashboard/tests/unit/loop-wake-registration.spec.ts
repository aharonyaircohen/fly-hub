import { describe, expect, it, vi } from "vitest";

import {
  LoopWakeSyncError,
  buildLoopWakeRegistrationArgs,
  syncLoopWakeRegistration,
} from "@dashboard/features/agency/server/loop-wake-registration";

describe("Loop wake registration", () => {
  it("reports failed schedule synchronization without exposing backend details", async () => {
    const mutation = vi
      .fn()
      .mockRejectedValue(new Error("private-backend-detail"));
    await expect(
      syncLoopWakeRegistration(
        { owner: "acme", repo: "widgets", loopId: "ci-health" },
        { mutation },
      ),
    ).rejects.toThrow(LoopWakeSyncError);
    await expect(
      syncLoopWakeRegistration(
        { owner: "acme", repo: "widgets", loopId: "ci-health" },
        { mutation },
      ),
    ).rejects.toThrow("Retry the same change");
  });
  it("always carries the schedule when enabling a registration", () => {
    const trigger = Object.freeze({
      type: "schedule" as const,
      every: "1d",
    });

    expect(
      buildLoopWakeRegistrationArgs({
        owner: "acme",
        repo: "widgets",
        loop: {
          id: "daily-health",
          trigger,
          target: { kind: "workflow", id: "qa-scan" },
          input: {},
          enabled: true,
        },
        updatedAt: "2026-08-20T07:00:00.000Z",
      }),
    ).toEqual({
      tenantId: "acme/widgets",
      loopId: "daily-health",
      enabled: true,
      trigger,
      updatedAt: "2026-08-20T07:00:00.000Z",
    });
  });

  it("registers only enabled scheduled Loops", async () => {
    const mutation = vi.fn(async () => ({ registered: true, count: 1 }));

    await syncLoopWakeRegistration(
      {
        owner: "acme",
        repo: "widgets",
        loop: {
          id: "ci-health",
          trigger: { type: "schedule", every: "15m" },
          target: { kind: "workflow", id: "ci-health" },
          input: {},
          enabled: true,
        },
      },
      { mutation },
    );

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "acme/widgets",
      loopId: "ci-health",
      enabled: true,
      trigger: { type: "schedule", every: "15m" },
      updatedAt: expect.any(String),
    });
  });

  it("unregisters disabled and manual Loops", async () => {
    const mutation = vi.fn(async () => ({ registered: false, count: 0 }));

    await syncLoopWakeRegistration(
      {
        owner: "acme",
        repo: "widgets",
        loop: {
          id: "manual-review",
          trigger: { type: "manual" },
          target: { kind: "workflow", id: "review" },
          input: {},
          enabled: true,
        },
      },
      { mutation },
    );

    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ loopId: "manual-review", enabled: false }),
    );
  });

  it("unregisters deleted Loops by id", async () => {
    const mutation = vi.fn(async () => ({ registered: false, count: 0 }));

    await syncLoopWakeRegistration(
      { owner: "acme", repo: "widgets", loopId: "ci-health" },
      { mutation },
    );

    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ loopId: "ci-health", enabled: false }),
    );
  });
});
