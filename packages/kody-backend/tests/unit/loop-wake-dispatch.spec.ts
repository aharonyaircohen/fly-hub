import { describe, expect, it, vi } from "vitest";

import {
  buildLoopWakeRequest,
  dispatchLoopWakeToDashboard,
} from "../../src/loop-wake-dispatch";

describe("Loop wake Dashboard dispatch", () => {
  it("builds the canonical scheduled fan-out request without credentials", () => {
    const job = buildLoopWakeRequest({
      tenantId: "acme/widgets",
      wakeId: "wake-1",
      loopId: "daily-check",
      scheduledFor: "2026-08-19T12:00:00.000Z",
    });

    expect(job).toEqual({
      jobId: "wake-1",
      repo: "acme/widgets",
      runRequest: {
        requestId: "wake-1",
        target: { type: "loop", id: "daily-check" },
        intent: "tick",
        source: "schedule",
        input: { scheduledFor: "2026-08-19T12:00:00.000Z" },
      },
    });
    expect(JSON.stringify(job)).not.toMatch(/token|secret|key/i);
  });

  it("uses authenticated HTTPS and returns only a safe result", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, runner: "github-actions" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      dispatchLoopWakeToDashboard(
        { tenantId: "acme/widgets", wakeId: "wake-1", loopId: "daily-check", scheduledFor: "2026-08-19T12:00:00.000Z" },
        {
          dashboardUrl: "https://dashboard.example.test/",
          wakeApiKey: "derived-key",
          fetcher,
        },
      ),
    ).resolves.toEqual({ ok: true, detail: "workflow accepted" });

    expect(fetcher).toHaveBeenCalledWith(
      "https://dashboard.example.test/api/kody/loop-wakes/dispatch",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer derived-key",
        }),
      }),
    );
  });

  it("rejects an insecure remote pool URL", async () => {
    await expect(
      dispatchLoopWakeToDashboard(
        { tenantId: "acme/widgets", wakeId: "wake-1", loopId: "daily-check", scheduledFor: "2026-08-19T12:00:00.000Z" },
        {
          dashboardUrl: "http://dashboard.example.test",
          wakeApiKey: "derived-key",
          fetcher: vi.fn(),
        },
      ),
    ).rejects.toThrow("HTTPS");
  });
});
