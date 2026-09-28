import { describe, expect, it } from "vitest";

import {
  activeBrainImageSaveJob,
  brainImageSavePollAction,
  brainMachineImageAction,
  classifyBrainImageApply,
  mergeSessionCookies,
  needsApiSessionSignIn,
  readBrainLifecycleProgress,
  shouldStartFreshBrainImageSave,
} from "../../scripts/lib/brain-runtime-operation.mjs";

describe("brainMachineImageAction", () => {
  const input = {
    runningApp: "brain-app",
    runningImageRef: "ghcr.io/kody/brain:saved",
  };

  it("accepts the exact prepared runtime image", () => {
    expect(
      brainMachineImageAction({
        ...input,
        machineImageRef: "registry.fly.io/brain-app:saved@sha256:abc",
        allowApply: false,
      }),
    ).toBe("verified");
  });

  it("rebaselines a stale machine image only in an authorized destructive run", () => {
    const stale = {
      ...input,
      machineImageRef: "registry.fly.io/brain-app:agent-access-old",
    };
    expect(brainMachineImageAction({ ...stale, allowRebaseline: false })).toBe(
      "mismatch",
    );
    expect(brainMachineImageAction({ ...stale, allowRebaseline: true })).toBe(
      "rebaseline",
    );
  });
});

describe("classifyBrainImageApply", () => {
  it("does not complete while the old machine is still running", () => {
    expect(
      classifyBrainImageApply(
        {
          runningImageRef: "ghcr.io/kody/old:1",
          runningApp: "brain",
          runningMachineId: "machine",
          runtime: {
            operation: {
              id: "restore-1",
              type: "apply-image",
              status: "running",
              imageRef: "ghcr.io/kody/new:1",
            },
          },
        },
        "restore-1",
        "ghcr.io/kody/new:1",
      ),
    ).toEqual({ status: "running" });
  });

  it("completes only when the operation and exact running image agree", () => {
    expect(
      classifyBrainImageApply(
        {
          runningImageRef: "ghcr.io/kody/new:1",
          runningApp: "brain",
          runningMachineId: "machine",
          runtime: {
            operation: {
              id: "restore-1",
              type: "apply-image",
              status: "completed",
              imageRef: "ghcr.io/kody/new:1",
            },
          },
        },
        "restore-1",
        "ghcr.io/kody/new:1",
      ),
    ).toEqual({ status: "completed" });
  });

  it("surfaces failed and replaced operations", () => {
    expect(
      classifyBrainImageApply(
        {
          runtime: {
            operation: {
              id: "restore-1",
              status: "failed",
              imageRef: "ghcr.io/kody/new:1",
              error: "Fly replace failed",
            },
          },
        },
        "restore-1",
        "ghcr.io/kody/new:1",
      ),
    ).toEqual({ status: "failed", message: "Fly replace failed" });
    expect(
      classifyBrainImageApply(
        { operation: { id: "restore-2" } },
        "restore-1",
        "ghcr.io/kody/new:1",
      ),
    ).toEqual({
      status: "conflict",
      message: "Brain restore operation was replaced before it completed",
    });
  });

  it("marks a running operation stale after its lease expires", () => {
    expect(
      classifyBrainImageApply(
        {
          runtime: {
            operation: {
              id: "restore-1",
              status: "running",
              imageRef: "ghcr.io/kody/new:1",
              updatedAt: "2026-09-12T10:00:00.000Z",
            },
          },
        },
        "restore-1",
        "ghcr.io/kody/new:1",
        {
          nowMs: Date.parse("2026-09-12T10:16:00.000Z"),
          staleAfterMs: 900_000,
        },
      ),
    ).toEqual({ status: "stale" });
  });
});

describe("mergeSessionCookies", () => {
  it("keeps unrelated cookies and replaces a rotated session", () => {
    expect(
      mergeSessionCookies("theme=dark; session=old", [
        "session=new; Path=/; HttpOnly; Secure",
      ]),
    ).toBe("theme=dark; session=new");
  });
});

describe("needsApiSessionSignIn", () => {
  it("preserves the mounted browser session instead of signing in separately", () => {
    expect(
      needsApiSessionSignIn({
        sessionCookie: "kody.session=browser-session",
        email: "live@example.test",
        password: "secret",
      }),
    ).toBe(false);
  });

  it("signs in only when credentials exist and no session was supplied", () => {
    expect(
      needsApiSessionSignIn({
        sessionCookie: "",
        email: "live@example.test",
        password: "secret",
      }),
    ).toBe(true);
    expect(
      needsApiSessionSignIn({ sessionCookie: "", email: "", password: "" }),
    ).toBe(false);
  });
});

describe("activeBrainImageSaveJob", () => {
  it("resumes only the durable running save", () => {
    expect(
      activeBrainImageSaveJob({
        save: { status: "running", jobId: "save-1" },
      }),
    ).toEqual({ jobId: "save-1" });
    expect(
      activeBrainImageSaveJob({
        save: { status: "completed", jobId: "save-1" },
      }),
    ).toBeNull();
    expect(activeBrainImageSaveJob({ save: null })).toBeNull();
  });
});

describe("shouldStartFreshBrainImageSave", () => {
  it("starts a marker-owned save after an older running save completes", () => {
    expect(shouldStartFreshBrainImageSave(true)).toBe(true);
    expect(shouldStartFreshBrainImageSave(false)).toBe(false);
  });
});

describe("brainImageSavePollAction", () => {
  it("drains an attached job that completed and cleared between polls", () => {
    expect(brainImageSavePollAction("idle", true)).toBe("drained");
  });

  it("rejects a current run's save when its durable job disappears", () => {
    expect(brainImageSavePollAction("idle", false, 59_999)).toBe(
      "reconciling",
    );
    expect(brainImageSavePollAction("idle", false, 60_000)).toBe("missing");
  });

  it("keeps running states pending and recognizes completion", () => {
    expect(brainImageSavePollAction("running", false)).toBe("pending");
    expect(brainImageSavePollAction("completed", false)).toBe("completed");
    expect(brainImageSavePollAction("failed", false)).toBe("failed");
  });
});

describe("readBrainLifecycleProgress", () => {
  it("reads the mounted page without requiring a reload while work continues", async () => {
    let reads = 0;

    await expect(
      readBrainLifecycleProgress({
        exitError: null,
        childCompleted: false,
        readPageText: async () => {
          reads += 1;
          return "Pushing the Brain image to GHCR";
        },
      }),
    ).resolves.toBe("Pushing the Brain image to GHCR");
    expect(reads).toBe(1);
  });

  it("reports completion without reading the page again", async () => {
    let reads = 0;

    await expect(
      readBrainLifecycleProgress({
        exitError: null,
        childCompleted: true,
        readPageText: async () => {
          reads += 1;
          return "unused";
        },
      }),
    ).resolves.toBe("Brain lifecycle completed");
    expect(reads).toBe(0);
  });
});
