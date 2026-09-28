import { describe, expect, it, vi } from "vitest";
import {
  deployFlyApp,
  manageFlyApp,
  type FlyAppDriver,
} from "../../src/apps/lifecycle";

function driver(): FlyAppDriver {
  return {
    ensureApp: vi.fn().mockResolvedValue(undefined),
    stageSecrets: vi.fn().mockResolvedValue(undefined),
    allocateIngress: vi.fn().mockResolvedValue(undefined),
    createMachine: vi.fn().mockResolvedValue("new-machine"),
    startMachine: vi.fn().mockResolvedValue(undefined),
    waitHealthy: vi.fn().mockResolvedValue(undefined),
    cordonMachine: vi.fn().mockResolvedValue(undefined),
    uncordonMachine: vi.fn().mockResolvedValue(undefined),
    stopMachine: vi.fn().mockResolvedValue(undefined),
    destroyMachine: vi.fn().mockResolvedValue(undefined),
    destroyApp: vi.fn().mockResolvedValue(undefined),
  };
}

describe("deployFlyApp", () => {
  it("gives token-gated private apps ingress and switches only after health", async () => {
    const fly = driver();
    const result = await deployFlyApp(fly, {
      appName: "kody-acme-web-api-12345678",
      imageRef: "registry/app:sha",
      region: "fra",
      internalPort: 3000,
      exposure: "private",
      secrets: { DATABASE_URL: "secret" },
      previousMachineId: "old-machine",
    });
    expect(result.machineId).toBe("new-machine");
    expect(fly.allocateIngress).toHaveBeenCalledWith(
      "kody-acme-web-api-12345678",
    );
    expect(fly.stageSecrets).toHaveBeenCalledBefore(
      vi.mocked(fly.createMachine),
    );
    expect(fly.waitHealthy).toHaveBeenCalledBefore(
      vi.mocked(fly.uncordonMachine),
    );
    expect(fly.uncordonMachine).toHaveBeenCalledBefore(
      vi.mocked(fly.destroyMachine),
    );
  });

  it("preserves the current machine when verification fails", async () => {
    const fly = driver();
    vi.mocked(fly.waitHealthy).mockRejectedValue(new Error("health failed"));
    await expect(
      deployFlyApp(fly, {
        appName: "app",
        imageRef: "image",
        region: "fra",
        internalPort: 3000,
        exposure: "public",
        secrets: {},
        previousMachineId: "old-machine",
      }),
    ).rejects.toThrow("health failed");
    expect(fly.destroyMachine).toHaveBeenCalledWith("app", "new-machine");
    expect(fly.destroyMachine).not.toHaveBeenCalledWith("app", "old-machine");
  });
});

describe("manageFlyApp", () => {
  it.each(["start", "stop", "restart"] as const)(
    "executes %s",
    async (action) => {
      const fly = driver();
      await manageFlyApp(fly, { action, appName: "app", machineId: "machine" });
      if (action === "start") expect(fly.startMachine).toHaveBeenCalled();
      if (action === "stop") expect(fly.stopMachine).toHaveBeenCalled();
      if (action === "restart") {
        expect(fly.stopMachine).toHaveBeenCalled();
        expect(fly.startMachine).toHaveBeenCalled();
      }
    },
  );
});
