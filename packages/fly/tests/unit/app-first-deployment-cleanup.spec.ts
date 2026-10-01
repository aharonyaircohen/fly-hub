import { describe, expect, it, vi } from "vitest";
import { cleanupFirstDeployment } from "../../builder/src/app-first-deployment-cleanup";
import { listFailedAppSetups } from "../../src/previews/builder-client";

describe("failed first setup cleanup", () => {
  it("removes only resources created by that run", async () => {
    const resources = new Set(["existing-app", "new-gateway", "new-runtime"]);
    const destroyVolume = vi.fn(async () => undefined);
    const result = await cleanupFirstDeployment({
      createdApps: ["new-gateway", "new-runtime"],
      createdVolumes: [
        { app: "new-runtime", id: "new-volume" },
        { app: "existing-app", id: "new-detached-volume" },
      ],
      destroyApp: async (app) => {
        resources.delete(app);
      },
      destroyVolume,
      appExists: async (app) => resources.has(app),
    });
    expect(result.status).toBe("completed");
    expect([...resources]).toEqual(["existing-app"]);
    expect(destroyVolume).toHaveBeenCalledExactlyOnceWith(
      "existing-app",
      "new-detached-volume",
    );
  });
  it("identifies remaining resources when Fly cannot remove an app", async () => {
    const result = await cleanupFirstDeployment({
      createdApps: ["new-app"],
      createdVolumes: [],
      destroyApp: async () => {
        throw new Error("Fly HTTP 503");
      },
      destroyVolume: vi.fn(),
      appExists: async () => true,
    });
    expect(result).toMatchObject({
      status: "needs_attention",
      detail: expect.stringContaining("new-app: Fly HTTP 503"),
    });
  });
  it("does not claim cleanup until Fly confirms removal", async () => {
    const result = await cleanupFirstDeployment({
      createdApps: ["new-app"],
      createdVolumes: [],
      destroyApp: async () => undefined,
      destroyVolume: vi.fn(),
      appExists: async () => true,
    });
    expect(result.status).toBe("needs_attention");
  });
});

describe("failed setup visibility", () => {
  it("shows only the newest failed setup belonging to the selected organization", async () => {
    const worker = (app: string, org: string, status: string, day: number) => ({
      id: `worker-${day}`,
      created_at: `2026-10-0${day}T00:00:00Z`,
      config: {
        metadata: {
          flyhub_build_app: app,
          flyhub_build_org: org,
          flyhub_build_status: status,
          flyhub_last_error: "failure detail",
          flyhub_cleanup_status: "completed",
        },
      },
    });
    const app = "flyhub-app-test-123456789abc";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          worker(app, "personal", "failed", 1),
          worker(app, "personal", "completed", 2),
          worker("flyhub-app-other-123456789abc", "another-org", "failed", 3),
          worker("flyhub-app-visible-123456789abc", "personal", "failed", 4),
        ]),
      ),
    );
    try {
      expect(await listFailedAppSetups("fake", "personal")).toMatchObject([
        {
          appName: "flyhub-app-visible-123456789abc",
          error: "failure detail",
          cleanup: { status: "completed" },
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
