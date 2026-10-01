import { describe, expect, it, vi } from "vitest";
import {
  replaceAppDeployment,
  type DeploymentActions,
} from "../../builder/src/app-deployment-transaction";

function fixture(failure?: "fork" | "secret" | "create" | "verify") {
  const events: string[] = [];
  const data = new Map([["original-volume", "original data"]]);
  let secret = "original secret";
  const previous = [{ app: "app", id: "original-machine", state: "started" }];
  const actions: DeploymentActions = {
    cordon: async (m) => {
      events.push(`cordon ${m.id}`);
    },
    stop: async (m) => {
      events.push(`stop ${m.id}`);
    },
    resume: async (m) => {
      events.push(`resume ${m.id}`);
    },
    destroy: async (m) => {
      events.push(`destroy ${m.id}`);
    },
    fork: async (v) => {
      if (failure === "fork") throw new Error("fork failed");
      data.set("copied-volume", data.get(v.volumeId)!);
      events.push("copy data");
      return { ...v, volumeId: "copied-volume" };
    },
    destroyVolume: async (v) => {
      data.delete(v.volumeId);
      events.push(`destroy ${v.volumeId}`);
    },
    applySecrets: async () => {
      secret = "new secret";
      if (failure === "secret") throw new Error("secret request timed out");
    },
    restoreSecrets: async () => {
      secret = "original secret";
    },
    verifyRecovery: async () => {
      expect(secret).toBe("original secret");
      events.push("old app checked");
    },
    deploy: async (volumes, register) => {
      if (failure === "create") throw new Error("create failed");
      register({ app: "app", id: "candidate-machine", state: "started" });
      data.set(volumes[0]!.volumeId, "new migration overwrote data");
      if (failure === "verify") throw new Error("new app failed verification");
      events.push("verified");
    },
    report: vi.fn(),
  };
  const run = () =>
    replaceAppDeployment({
      previous,
      storage: [{ volumeId: "original-volume", mountPath: "/data" }],
      previousVolumeIds: new Set(["original-volume"]),
      actions,
    });
  return { run, events, data, actions, secret: () => secret };
}

describe("safe app replacement", () => {
  it.each(["fork", "secret", "create", "verify"] as const)(
    "recovers the original deployment after %s failure",
    async (failure) => {
      const f = fixture(failure);
      await expect(f.run()).rejects.toThrow();
      expect(f.data.get("original-volume")).toBe("original data");
      expect(f.data.has("copied-volume")).toBe(false);
      expect(f.secret()).toBe("original secret");
      expect(f.events).toContain("resume original-machine");
      expect(f.events).not.toContain("destroy original-machine");
      expect(f.events).toContain("old app checked");
    },
  );

  it("retires originals only after the replacement has been verified", async () => {
    const f = fixture();
    await f.run();
    expect(f.events.indexOf("destroy original-machine")).toBeGreaterThan(
      f.events.indexOf("verified"),
    );
    expect(f.data.get("copied-volume")).toBe("new migration overwrote data");
    expect(f.data.has("original-volume")).toBe(false);
  });

  it("reports failed recovery instead of hiding it behind the build error", async () => {
    const f = fixture("verify");
    f.actions.restoreSecrets = async () => {
      throw new Error("Fly secret restoration unavailable");
    };
    await expect(f.run()).rejects.toThrow(
      /DEPLOYMENT_RECOVERY_FAILED.*restore previous secrets/,
    );
    expect(f.events).toContain("resume original-machine");
    expect(f.data.get("original-volume")).toBe("original data");
  });

  it("does not tear down a verified app when retirement fails", async () => {
    const f = fixture();
    f.actions.destroy = async () => {
      throw new Error("old machine is leased");
    };
    await expect(f.run()).resolves.toBeUndefined();
    expect(f.actions.report).toHaveBeenCalledWith(
      expect.stringContaining("still needs cleanup"),
    );
    expect(f.events).not.toContain("resume original-machine");
  });
});
