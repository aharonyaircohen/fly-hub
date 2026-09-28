/**
 * @fileoverview Unit coverage for Brain service resolution.
 * @testFramework vitest
 * @domain brain
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  readBrainApp: vi.fn(),
}));

const runtimeManager = vi.hoisted(() => ({
  readBrainRuntimeView: vi.fn(),
}));

const target = vi.hoisted(() => ({
  resolveBrainTarget: vi.fn(),
}));

const flyPreviews = vi.hoisted(() => ({
  listMachines: vi.fn(),
}));

const brainFly = vi.hoisted(() => ({
  brainStatus: vi.fn(),
}));

vi.mock("@kody-ade/brain/store", () => store);
vi.mock("@kody-ade/brain/runtime-manager", () => runtimeManager);
vi.mock("@kody-ade/brain/target", () => target);
vi.mock("@kody-ade/fly/plugin/previews/machines-client", () => flyPreviews);
vi.mock("@kody-ade/fly/plugin/runners/brain", () => brainFly);

describe("resolveBrainService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FLY_API_TOKEN;
    store.readBrainApp.mockResolvedValue({
      app: "brain-1",
      orgSlug: "personal",
    });
    runtimeManager.readBrainRuntimeView.mockResolvedValue({ source: "empty" });
    target.resolveBrainTarget.mockReturnValue({
      app: "brain-1",
      orgSlug: "personal",
    });
    brainFly.brainStatus.mockResolvedValue({
      app: "brain-1",
      state: "running",
      url: "https://brain-1.fly.dev",
      machineId: "m-old",
      org: "personal",
    });
    flyPreviews.listMachines.mockResolvedValue([
      {
        id: "m-old",
        state: "started",
        region: "fra",
        createdAt: "2026-07-02T09:00:00.000Z",
      },
      {
        id: "m-runtime",
        state: "suspended",
        region: "fra",
        createdAt: "2026-07-02T10:00:00.000Z",
      },
    ]);
  });

  it("uses the runtime machine id when resolving the active Brain machine", async () => {
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      source: "runtime",
      runningApp: "brain-1",
      runningMachineId: "m-runtime",
      runningOrgSlug: "personal",
      runningUrl: "https://brain-1.fly.dev",
    });
    const { resolveBrainService } =
      await import("@kody-ade/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "fly-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(brainFly.brainStatus).toHaveBeenCalledWith(
      expect.objectContaining({ machineIdOverride: "m-runtime" }),
    );
    expect(resolved.machineId).toBe("m-runtime");
    expect(resolved.machine?.machineId).toBe("m-runtime");
  });

  it("does not let stale runtime app state replace the stored Brain app", async () => {
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      source: "runtime",
      runningApp: "old-brain",
      runningMachineId: "m-runtime",
      runningOrgSlug: "old-org",
      runningUrl: "https://old-brain.fly.dev",
    });
    const { resolveBrainService } =
      await import("@kody-ade/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "fly-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(brainFly.brainStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        appNameOverride: "brain-1",
        machineIdOverride: undefined,
        orgSlug: "personal",
      }),
    );
    expect(flyPreviews.listMachines).toHaveBeenCalledWith(
      "brain-1",
      expect.objectContaining({ orgSlug: "personal" }),
    );
    expect(resolved.app).toBe("brain-1");
  });

  it("uses the verified running Brain when the stored app is rejected as foreign", async () => {
    store.readBrainApp.mockResolvedValueOnce({
      appName: "kody-brain-aharonyaircohen",
      orgSlug: "aharon-yair-cohen",
    });
    target.resolveBrainTarget.mockReturnValueOnce({
      app: "kody-brain-aguyaharonyair",
      orgSlug: "personal",
      source: "default",
    });
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      source: "runtime",
      runningApp: "kody-brain-aharonyaircohen",
      runningMachineId: "m-runtime",
      runningOrgSlug: "aharon-yair-cohen",
      runningUrl: "https://kody-brain-aharonyaircohen.fly.dev",
    });
    brainFly.brainStatus.mockResolvedValueOnce({
      app: "kody-brain-aharonyaircohen",
      state: "running",
      url: "https://kody-brain-aharonyaircohen.fly.dev",
      machineId: "m-runtime",
      org: "aharon-yair-cohen",
    });
    flyPreviews.listMachines.mockResolvedValueOnce([
      {
        id: "m-runtime",
        state: "started",
        region: "fra",
        createdAt: "2026-07-14T09:00:00.000Z",
      },
    ]);
    const { resolveBrainService } =
      await import("@kody-ade/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "fly-token",
      account: "aguyaharonyair",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(brainFly.brainStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        appNameOverride: "kody-brain-aharonyaircohen",
        machineIdOverride: "m-runtime",
        orgSlug: "aharon-yair-cohen",
      }),
    );
    expect(resolved).toMatchObject({
      app: "kody-brain-aharonyaircohen",
      state: "running",
      machineId: "m-runtime",
    });
  });

  it("recovers from a stale runtime id when one Brain machine is running", async () => {
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      source: "runtime",
      runningApp: "brain-1",
      runningMachineId: "m-missing",
      runningOrgSlug: "personal",
      runningUrl: "https://brain-1.fly.dev",
    });
    const { resolveBrainService } =
      await import("@kody-ade/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "fly-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(resolved.machine?.machineId).toBe("m-old");
    expect(resolved.machineId).toBe("m-old");
    expect(resolved.state).toBe("running");
    expect(resolved.reason).toBeUndefined();
  });

  it("does not use the environment Fly token when the stored Brain is hidden", async () => {
    process.env.FLY_API_TOKEN = "fallback-token";
    brainFly.brainStatus
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "off",
        org: "personal",
      })
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "running",
        url: "https://brain-1.fly.dev",
        machineId: "m-fallback",
        org: "personal",
      });
    flyPreviews.listMachines
      .mockRejectedValueOnce(new Error("not visible"))
      .mockResolvedValueOnce([
        {
          id: "m-fallback",
          state: "started",
          region: "fra",
          createdAt: "2026-07-02T10:00:00.000Z",
        },
      ]);
    const { resolveBrainService } =
      await import("@kody-ade/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "vault-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(resolved.flyToken).toBe("vault-token");
    expect(resolved.machine).toBeUndefined();
    expect(brainFly.brainStatus).toHaveBeenCalledTimes(1);
    expect(flyPreviews.listMachines).toHaveBeenCalledTimes(1);
    brainFly.brainStatus.mockReset();
    flyPreviews.listMachines.mockReset();
    delete process.env.FLY_API_TOKEN;
  });

  it("does not prefer the environment Fly token for the same Brain machine", async () => {
    process.env.FLY_API_TOKEN = "fallback-token";
    brainFly.brainStatus
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "running",
        url: "https://brain-1.fly.dev",
        machineId: "m-old",
        org: "personal",
      })
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "running",
        url: "https://brain-1.fly.dev",
        machineId: "m-old",
        org: "personal",
      });
    flyPreviews.listMachines
      .mockResolvedValueOnce([
        {
          id: "m-old",
          state: "started",
          region: "fra",
          createdAt: "2026-07-02T10:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "m-old",
          state: "started",
          region: "fra",
          createdAt: "2026-07-02T10:00:00.000Z",
        },
      ]);
    const { resolveBrainService } =
      await import("@kody-ade/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "vault-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(resolved.flyToken).toBe("vault-token");
    expect(resolved.machineId).toBe("m-old");
    expect(brainFly.brainStatus).toHaveBeenCalledTimes(1);
    expect(flyPreviews.listMachines).toHaveBeenCalledTimes(1);
    brainFly.brainStatus.mockReset();
    flyPreviews.listMachines.mockReset();
    delete process.env.FLY_API_TOKEN;
  });

  it("does not use the environment Fly token for runtime-only Brain records", async () => {
    process.env.FLY_API_TOKEN = "fallback-token";
    store.readBrainApp.mockResolvedValueOnce(null);
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      source: "runtime",
      runningApp: "brain-1",
      runningMachineId: "m-runtime",
      runningOrgSlug: "personal",
    });
    brainFly.brainStatus
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "off",
        org: "personal",
      })
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "running",
        url: "https://brain-1.fly.dev",
        machineId: "m-runtime",
        org: "personal",
      });
    flyPreviews.listMachines
      .mockRejectedValueOnce(new Error("not visible"))
      .mockResolvedValueOnce([
        {
          id: "m-runtime",
          state: "started",
          region: "fra",
          createdAt: "2026-07-02T10:00:00.000Z",
        },
      ]);
    const { resolveBrainService } =
      await import("@kody-ade/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "vault-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(resolved.flyToken).toBe("vault-token");
    expect(resolved.machineId).toBe("m-runtime");
    expect(resolved.machine).toBeUndefined();
    expect(brainFly.brainStatus).toHaveBeenCalledTimes(1);
    expect(flyPreviews.listMachines).toHaveBeenCalledTimes(1);
    brainFly.brainStatus.mockReset();
    flyPreviews.listMachines.mockReset();
    delete process.env.FLY_API_TOKEN;
  });

  it("keeps Fly authorization failures separate from missing apps", async () => {
    brainFly.brainStatus.mockResolvedValueOnce({
      app: "brain-1",
      state: "off",
      org: "personal",
      accessDenied: true,
    });
    flyPreviews.listMachines.mockRejectedValueOnce(
      Object.assign(new Error("unauthorized"), { status: 403 }),
    );
    const { resolveBrainService } =
      await import("@kody-ade/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "vault-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(resolved.reason).toBe("fly_access_denied");
    expect(resolved.state).toBe("off");
    expect(resolved.stored).toBeTruthy();
  });
});
