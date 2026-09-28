import { beforeEach, describe, expect, it, vi } from "vitest";

const listMachines = vi.fn();
const startMachine = vi.fn();
const waitForMachineStarted = vi.fn();
let desiredStatus = "running";

const access = {
  auth: { owner: "test-owner", repo: "test-repo" },
};
vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoReadAccess: vi.fn(async () => access),
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: vi.fn(async () => ({
      appId: "app-1",
      desiredStatus,
      exposure: "private",
      provider: {
        appName: "open-notebook",
        publicUrl: "https://open-notebook.fly.dev",
      },
    })),
  }),
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: { apps: { get: "apps:get" } },
}));
vi.mock("@kody-ade/fly/apps/config", () => ({
  resolveAppHostingConfig: () => ({ token: "fly-token" }),
}));
vi.mock("@kody-ade/fly/apps/machines-client", () => ({
  listMachines,
  startMachine,
  waitForMachineStarted,
}));

describe("Apps open route", () => {
  beforeEach(() => {
    desiredStatus = "running";
    listMachines
      .mockReset()
      .mockResolvedValue([{ id: "machine-1", state: "stopped" }]);
    startMachine.mockReset().mockResolvedValue(undefined);
    waitForMachineStarted.mockReset().mockResolvedValue(undefined);
    process.env.KODY_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("returns a short-lived authenticated launch URL for the Dashboard UI", async () => {
    const { POST } = await import("../../app/api/kody/apps/[slug]/open/route");
    const response = await POST(new Request("http://local/open") as never, {
      params: Promise.resolve({ slug: "open-notebook" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toMatch(/^https:\/\/open-notebook\.fly\.dev\/?\?ka=/);
    expect(body.url).not.toContain("kody-app-");
    expect(startMachine).toHaveBeenCalledWith("open-notebook", "machine-1", {
      token: "fly-token",
    });
    expect(waitForMachineStarted).toHaveBeenCalledWith(
      "open-notebook",
      "machine-1",
      { token: "fly-token" },
    );
  });

  it("does not wake an app the user explicitly stopped", async () => {
    desiredStatus = "stopped";
    const { POST } = await import("../../app/api/kody/apps/[slug]/open/route");
    const response = await POST(new Request("http://local/open") as never, {
      params: Promise.resolve({ slug: "open-notebook" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "app_stopped" });
    expect(startMachine).not.toHaveBeenCalled();
  });
});
