/**
 * @fileoverview Unit coverage for saved Brain image metadata.
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

describe("Brain image store", () => {
  beforeEach(() => {
    vi.resetModules();
    state.loadState.mockReset();
    state.saveState.mockReset();
  });

  it("reads the per-user Brain image record from Convex", async () => {
    state.loadState.mockResolvedValue({
      ...{
        version: 1,
        imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
        images: [
          {
            imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
            createdAt: "2026-06-25T10:00:00.000Z",
            updatedAt: "2026-06-25T10:00:00.000Z",
          },
        ],
      },
    });
    const { readBrainImage } = await import("@kody-ade/brain/store");

    await expect(readBrainImage("Alice", "token")).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
      images: [
        expect.objectContaining({
          imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
        }),
      ],
    });
    expect(state.loadState).toHaveBeenCalledWith(
      "user-alice",
      "images",
    );
  });

  it("does not retry a missing Convex document through another adapter", async () => {
    state.loadState.mockResolvedValueOnce(null);
    const { readBrainImage } = await import("@kody-ade/brain/store");

    await expect(readBrainImage("Alice", "token")).resolves.toBeNull();
    expect(state.loadState).toHaveBeenNthCalledWith(
      1,
      "user-alice",
      "images",
    );
    expect(state.loadState).toHaveBeenCalledTimes(1);
  });

  it("reads the stored Brain app from user-level state", async () => {
    state.loadState.mockResolvedValue({
      ...{
        version: 1,
        appName: "kody-brain-alice",
        orgSlug: "personal",
        createdAt: "2026-06-25T10:00:00.000Z",
      },
    });
    const { readBrainApp } = await import("@kody-ade/brain/store");

    await expect(readBrainApp("Alice", "token")).resolves.toMatchObject({
      appName: "kody-brain-alice",
    });
    expect(state.loadState).toHaveBeenCalledWith(
      "user-alice",
      "app",
    );
  });

  it("writes the stored Brain app to user-level state", async () => {
    state.loadState.mockResolvedValue(null);
    state.saveState.mockResolvedValue({ sha: "new-sha" });
    const { writeBrainApp } = await import("@kody-ade/brain/store");

    await writeBrainApp("Alice", "token", {
      version: 1,
      appName: "kody-brain-alice",
      orgSlug: "personal",
      createdAt: "2026-06-25T10:00:00.000Z",
    });

    expect(state.saveState).toHaveBeenCalledWith(
      "user-alice",
      "app",
      expect.objectContaining({ version: 1 }),
    );
  });

  it("clears the user-level Brain app document once", async () => {
    state.loadState.mockResolvedValueOnce({
      sha: "root-sha",
      content: "{}",
    });
    state.saveState.mockResolvedValue(undefined);
    const { clearBrainApp } = await import("@kody-ade/brain/store");

    await clearBrainApp("Alice", "token");

    expect(state.saveState).toHaveBeenCalledWith(
      "user-alice",
      "app",
      null,
    );
    expect(state.saveState).toHaveBeenCalledTimes(1);
  });

  it("writes the per-user Brain image record without touching brain.json", async () => {
    state.loadState.mockResolvedValue(null);
    state.saveState.mockResolvedValue({ sha: "new-sha" });
    const { writeBrainImage } = await import("@kody-ade/brain/store");

    await writeBrainImage("Alice", "token", {
      version: 1,
      imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
      createdAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T10:00:00.000Z",
      images: [
        {
          imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-25T10:00:00.000Z",
        },
      ],
    });

    expect(state.saveState).toHaveBeenCalledWith(
      "user-alice",
      "images",
      expect.objectContaining({ version: 1 }),
    );
  });

  it("writes catalog-only Brain images without inventing selected or running state", async () => {
    state.loadState.mockResolvedValue(null);
    state.saveState.mockResolvedValue({ sha: "new-sha" });
    const { writeBrainImage } = await import("@kody-ade/brain/store");

    await writeBrainImage("Alice", "token", {
      version: 1,
      createdAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T10:00:00.000Z",
      images: [
        {
          imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-25T10:00:00.000Z",
        },
      ],
    });

    const content = state.saveState.mock.calls[0]?.[2] as {
      imageRef?: string;
      runningImageRef?: string;
      runningApp?: string;
      runningMachineId?: string;
    };
    expect(content.imageRef).toBeUndefined();
    expect(content.runningImageRef).toBeUndefined();
    expect(content.runningApp).toBeUndefined();
    expect(content.runningMachineId).toBeUndefined();
  });

  it("selects a saved Brain image without deleting the image list", async () => {
    state.loadState
      .mockResolvedValueOnce({
        ...{
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-25T10:00:00.000Z",
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
              createdAt: "2026-06-26T10:00:00.000Z",
              updatedAt: "2026-06-26T10:00:00.000Z",
            },
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
              createdAt: "2026-06-25T10:00:00.000Z",
              updatedAt: "2026-06-25T10:00:00.000Z",
            },
          ],
        },
      })
      .mockResolvedValueOnce({ sha: "sha", content: "{}" });
    state.saveState.mockResolvedValue({ sha: "new-sha" });
    const { selectBrainImage } = await import("@kody-ade/brain/store");

    await expect(
      selectBrainImage(
        "Alice",
        "token",
        "ghcr.io/alice/kody-brain-snapshot:new",
      ),
    ).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      images: expect.arrayContaining([
        expect.objectContaining({
          imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
        }),
      ]),
    });
  });

  it("refreshes stale image cache before rejecting a selected image", async () => {
    state.loadState
      .mockResolvedValueOnce({
        ...{
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-25T10:00:00.000Z",
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
              createdAt: "2026-06-25T10:00:00.000Z",
              updatedAt: "2026-06-25T10:00:00.000Z",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ...{
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:00.000Z",
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
              createdAt: "2026-06-26T10:00:00.000Z",
              updatedAt: "2026-06-26T10:00:00.000Z",
            },
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
              createdAt: "2026-06-25T10:00:00.000Z",
              updatedAt: "2026-06-25T10:00:00.000Z",
            },
          ],
        },
      })
      .mockResolvedValueOnce({ sha: "new-sha", content: "{}" });
    state.saveState.mockResolvedValue({ sha: "written-sha" });
    const { readBrainImage, selectBrainImage } =
      await import("@kody-ade/brain/store");

    await readBrainImage("Alice", "token");
    await expect(
      selectBrainImage(
        "Alice",
        "token",
        "ghcr.io/alice/kody-brain-snapshot:new",
      ),
    ).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
    });

    expect(state.loadState).toHaveBeenNthCalledWith(
      2,
      "user-alice",
      "images",
    );
  });

  it("removes a deleted Brain image from dashboard metadata", async () => {
    state.loadState
      .mockResolvedValueOnce({
        ...{
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:00.000Z",
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
              createdAt: "2026-06-26T10:00:00.000Z",
              updatedAt: "2026-06-26T10:00:00.000Z",
            },
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
              createdAt: "2026-06-25T10:00:00.000Z",
              updatedAt: "2026-06-25T10:00:00.000Z",
            },
          ],
        },
      })
      .mockResolvedValueOnce({ sha: "sha", content: "{}" });
    state.saveState.mockResolvedValue({ sha: "new-sha" });
    const { deleteBrainImage } = await import("@kody-ade/brain/store");

    await expect(
      deleteBrainImage(
        "Alice",
        "token",
        "ghcr.io/alice/kody-brain-snapshot:old",
      ),
    ).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      images: [
        expect.objectContaining({
          imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
        }),
      ],
    });
    const content = state.saveState.mock.calls[0]?.[2] as { forgottenImageRefs?: string[] };
    expect(content.forgottenImageRefs).toBeUndefined();
  });

  it("does not create metadata when a deleted image was only discovered remotely", async () => {
    state.loadState
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    state.saveState.mockResolvedValue({ sha: "new-sha" });
    const { deleteBrainImage } = await import("@kody-ade/brain/store");

    await expect(
      deleteBrainImage(
        "Alice",
        "token",
        "ghcr.io/alice/kody-brain-snapshot:discovered",
      ),
    ).resolves.toBeNull();
    expect(state.saveState).not.toHaveBeenCalled();
  });

  it("marks a selected Brain image as running after apply succeeds", async () => {
    state.loadState
      .mockResolvedValueOnce({
        ...{
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:00.000Z",
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
              createdAt: "2026-06-26T10:00:00.000Z",
              updatedAt: "2026-06-26T10:00:00.000Z",
            },
          ],
        },
      })
      .mockResolvedValueOnce({ sha: "sha", content: "{}" });
    state.saveState.mockResolvedValue({ sha: "new-sha" });
    const { markBrainImageRunning } = await import("@kody-ade/brain/store");

    await expect(
      markBrainImageRunning("Alice", "token", {
        imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
        app: "kody-brain-alice",
        machineId: "machine-new",
        runningAt: "2026-07-02T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      runningImageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      runningApp: "kody-brain-alice",
      runningMachineId: "machine-new",
    });

    const content = state.saveState.mock.calls[0]?.[2] as { runningImageRef?: string; runningMachineId?: string };
    expect(content.runningImageRef).toBe(
      "ghcr.io/alice/kody-brain-snapshot:new",
    );
    expect(content.runningMachineId).toBe("machine-new");
  });

  it("marks an applied saved Brain image as selected and running", async () => {
    state.loadState
      .mockResolvedValueOnce({
        ...{
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:00.000Z",
          forgottenImageRefs: ["ghcr.io/alice/kody-brain-snapshot:new"],
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
              createdAt: "2026-06-25T10:00:00.000Z",
              updatedAt: "2026-06-25T10:00:00.000Z",
            },
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
              createdAt: "2026-06-26T10:00:00.000Z",
              updatedAt: "2026-06-26T10:00:00.000Z",
            },
          ],
        },
      })
      .mockResolvedValueOnce({ sha: "sha", content: "{}" });
    state.saveState.mockResolvedValue({ sha: "new-sha" });
    const { markBrainImageRunning } = await import("@kody-ade/brain/store");

    await expect(
      markBrainImageRunning("Alice", "token", {
        imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
        app: "kody-brain-alice",
        machineId: "machine-new",
        runningAt: "2026-07-02T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      runningImageRef: "ghcr.io/alice/kody-brain-snapshot:new",
    });

    const content = state.saveState.mock.calls[0]?.[2] as {
      imageRef?: string;
      runningImageRef?: string;
      forgottenImageRefs?: string[];
    };
    expect(content.imageRef).toBe("ghcr.io/alice/kody-brain-snapshot:new");
    expect(content.runningImageRef).toBe(
      "ghcr.io/alice/kody-brain-snapshot:new",
    );
    expect(content.forgottenImageRefs).toBeUndefined();
  });

  it("accepts GHCR image refs", async () => {
    const { writeBrainImage } = await import("@kody-ade/brain/store");

    state.loadState.mockResolvedValue(null);
    await expect(
      writeBrainImage("Alice", "token", {
        version: 1,
        imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
        images: [
          {
            imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
            createdAt: "2026-06-25T10:00:00.000Z",
            updatedAt: "2026-06-25T10:00:00.000Z",
          },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects non-GHCR image refs", async () => {
    const { writeBrainImage } = await import("@kody-ade/brain/store");

    await expect(
      writeBrainImage("Alice", "token", {
        version: 1,
        imageRef: "docker.io/alice/kody-brain-snapshot:latest",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
        images: [],
      }),
    ).rejects.toThrow("Invalid Brain image record");
    await expect(
      writeBrainImage("Alice", "token", {
        version: 1,
        imageRef: "registry.fly.io/kody-brain-alice:20260625",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
        images: [],
      }),
    ).rejects.toThrow("Invalid Brain image record");
    expect(state.saveState).not.toHaveBeenCalled();
  });

  it("writes and clears an in-progress Brain image save job", async () => {
    state.loadState.mockResolvedValueOnce(null);
    state.saveState.mockResolvedValue({ sha: "job-sha" });
    const { writeBrainImageSave, clearBrainImageSave } =
      await import("@kody-ade/brain/store");

    await writeBrainImageSave("Alice", "token", {
      version: 1,
      status: "running",
      phase: "pushing-image",
      message: "Pushing the Brain image to GHCR",
      lastOutput: "layer upload",
      jobId: "0123456789abcdef0123456789abcdef",
      app: "brain-1",
      machineId: "m123",
      bridgeApp: "kody-terminal-personal-abc123",
      orgSlug: "personal",
      defaultRegion: "fra",
      expectedImageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
      startedAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T10:00:00.000Z",
    });

    expect(state.saveState).toHaveBeenCalledWith(
      "user-alice",
      "image-save",
      expect.objectContaining({ version: 1 }),
    );

    state.loadState.mockResolvedValueOnce({
      sha: "job-sha",
      content: "{}",
    });
    state.saveState.mockResolvedValueOnce(undefined);
    await clearBrainImageSave("Alice", "token");
    expect(state.saveState).toHaveBeenCalledWith(
      "user-alice",
      "image-save",
      null,
    );
  });
});
