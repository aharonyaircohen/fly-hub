import { describe, expect, it, vi } from "vitest";

import {
  startLoop,
  type LoopExecutionDependencies,
} from "@dashboard/features/workflows/server/start-loop";

const loop = {
  id: "learn-from-runs",
  trigger: { type: "schedule" as const, every: "1h" },
  target: { kind: "workflow" as const, id: "learn-from-runs" },
  input: {},
  enabled: true,
};

function dependencies(
  overrides: Partial<LoopExecutionDependencies> = {},
): LoopExecutionDependencies {
  return {
    createRequestId: () => "run-loop-1",
    loadLoop: vi.fn(async () => loop),
    authorize: vi.fn(async () => true),
    dispatch: vi.fn(async (request) => ({
      requestId: request.requestId,
      acceptedAt: "2026-07-27T12:00:00.000Z",
    })),
    ...overrides,
  };
}

describe("startLoop", () => {
  it("dispatches only the selected Loop through the Engine contract", async () => {
    const deps = dependencies();

    const result = await startLoop(
      { loopId: "learn-from-runs", source: "dashboard", approved: true },
      deps,
    );

    expect(deps.dispatch).toHaveBeenCalledWith({
      requestId: "run-loop-1",
      target: { type: "loop", id: "learn-from-runs" },
      intent: "run",
      source: "dashboard",
    });
    expect(result).toMatchObject({
      kind: "accepted",
      loopId: "learn-from-runs",
      requestId: "run-loop-1",
    });
  });

  it("does not dispatch missing, disabled, or unapproved Loops", async () => {
    const missing = dependencies({ loadLoop: vi.fn(async () => null) });
    const disabled = dependencies({
      loadLoop: vi.fn(async () => ({ ...loop, enabled: false })),
    });
    const unapproved = dependencies({
      authorize: vi.fn(async () => false),
    });

    await expect(
      startLoop({ loopId: "missing", source: "dashboard" }, missing),
    ).resolves.toEqual({ kind: "not-found" });
    await expect(
      startLoop(
        { loopId: "learn-from-runs", source: "dashboard" },
        disabled,
      ),
    ).resolves.toEqual({ kind: "disabled" });
    await expect(
      startLoop(
        { loopId: "learn-from-runs", source: "dashboard" },
        unapproved,
      ),
    ).resolves.toEqual({ kind: "approval-required" });
    expect(missing.dispatch).not.toHaveBeenCalled();
    expect(disabled.dispatch).not.toHaveBeenCalled();
    expect(unapproved.dispatch).not.toHaveBeenCalled();
  });
});
