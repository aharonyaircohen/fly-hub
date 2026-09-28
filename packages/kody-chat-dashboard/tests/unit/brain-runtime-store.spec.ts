/**
 * @fileoverview Unit coverage for Brain runtime state boundaries.
 * @testFramework vitest
 * @domain brain
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

vi.mock("@kody-ade/brain/personal-services", () => ({
  getPersonalBrainServices: () => ({
    resolveUser: async () => ({ id: "user-alice", label: "Alice" }),
    loadState: state.loadState,
    saveState: state.saveState,
  }),
}));

describe("Brain runtime store", () => {
  beforeEach(() => {
    vi.resetModules();
    state.loadState.mockReset();
    state.saveState.mockReset();
  });

  it("writes personal runtime state, not the image catalog", async () => {
    state.loadState.mockResolvedValue(null);
    const { writeBrainRuntimeState } =
      await import("@kody-ade/brain/runtime-store");

    await writeBrainRuntimeState("Alice", "token", {
      version: 1,
      desiredImageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      running: {
        imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
        app: "brain-1",
        machineId: "machine-1",
        orgSlug: "personal",
        appliedAt: "2026-07-02T10:00:00.000Z",
      },
      updatedAt: "2026-07-02T10:00:00.000Z",
    });

    expect(state.saveState).toHaveBeenCalledWith(
      "user-alice",
      "runtime",
      expect.objectContaining({
        desiredImageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      }),
    );
  });

  it("rejects invalid runtime image refs", async () => {
    const { writeBrainRuntimeState } =
      await import("@kody-ade/brain/runtime-store");

    await expect(
      writeBrainRuntimeState("Alice", "token", {
        version: 1,
        desiredImageRef: "registry.fly.io/brain-1:new",
        updatedAt: "2026-07-02T10:00:00.000Z",
      }),
    ).rejects.toThrow("Invalid Brain runtime state");
    expect(state.saveState).not.toHaveBeenCalled();
  });

  it("rejects completed apply state without a recorded running machine", async () => {
    const { writeBrainRuntimeState } =
      await import("@kody-ade/brain/runtime-store");

    await expect(
      writeBrainRuntimeState("Alice", "token", {
        version: 1,
        desiredImageRef: "ghcr.io/alice/kody-brain-snapshot:new",
        operation: {
          id: "op-1",
          type: "apply-image",
          status: "completed",
          imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
          startedAt: "2026-07-02T10:00:00.000Z",
          updatedAt: "2026-07-02T10:01:00.000Z",
        },
        updatedAt: "2026-07-02T10:01:00.000Z",
      }),
    ).rejects.toThrow("Invalid Brain runtime state");
    expect(state.saveState).not.toHaveBeenCalled();
  });
});
