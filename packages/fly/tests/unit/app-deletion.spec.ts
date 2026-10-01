import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppDeletionError,
  deleteFlyHubApp,
} from "../../src/hub/app-management";
import {
  listAppsByPrefix,
  listMachines,
} from "../../src/plugin/previews/machines-client";
import { runtimeAppName } from "../../builder/src/app-builder-names";
vi.mock("../../src/plugin/previews/machines-client", () => ({
  listAppsByPrefix: vi.fn(),
  listMachines: vi.fn(),
}));
const app = "flyhub-app-test-123456789abc",
  runtime = runtimeAppName(app);
const cfg = { token: "fly-secret", orgSlug: "personal", defaultRegion: "lhr" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAppsByPrefix).mockResolvedValue([app, runtime]);
  vi.mocked(listMachines).mockImplementation(async (name) =>
    name === app
      ? [
          {
            id: "gateway",
            state: "started",
            region: "lhr",
            config: { env: { FLY_HUB_PASSWORD_HASH: "hash" } },
          },
        ]
      : [],
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("FlyHub app deletion", () => {
  it("removes only the selected runtime and gateway and keeps GHCR backups", async () => {
    const fetch = vi.fn(
      async (_url, init) =>
        new Response("", { status: init?.method === "DELETE" ? 200 : 404 }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await deleteFlyHubApp(app, cfg)).toEqual({
      deletedApps: [runtime, app],
      backupsKept: true,
    });
    expect(
      fetch.mock.calls
        .filter(([, init]) => init?.method === "DELETE")
        .map(([url]) => url),
    ).toEqual([
      `https://api.machines.dev/v1/apps/${runtime}?force=true`,
      `https://api.machines.dev/v1/apps/${app}?force=true`,
    ]);
    expect(
      fetch.mock.calls.every(([url]) =>
        String(url).startsWith("https://api.machines.dev/v1/apps/"),
      ),
    ).toBe(true);
  });
  it("rejects unrelated apps and apps outside the signed-in organization", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(deleteFlyHubApp("other-app", cfg)).rejects.toMatchObject({
      status: 404,
    });
    vi.mocked(listAppsByPrefix).mockResolvedValue([]);
    await expect(deleteFlyHubApp(app, cfg)).rejects.toMatchObject({
      status: 404,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a lookalike without a FlyHub password gateway", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.mocked(listMachines).mockResolvedValue([]);
    await expect(deleteFlyHubApp(app, cfg)).rejects.toMatchObject({
      status: 404,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["setup", "save"])(
    "does not delete machines during an active %s",
    async (kind) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      vi.mocked(listMachines).mockImplementation(async (name) =>
        name === app
          ? [
              {
                id: "gateway",
                state: "started",
                region: "lhr",
                config: { env: { FLY_HUB_PASSWORD_HASH: "hash" } },
              },
            ]
          : [
              {
                id: "worker",
                state: "started",
                region: "lhr",
                config:
                  kind === "setup"
                    ? { env: { APP_NAME: app } }
                    : {
                        metadata: {
                          flyhub_image_org: "personal",
                          flyhub_image_status: "working",
                          flyhub_image_source: app,
                        },
                      },
              },
            ],
      );
      await expect(deleteFlyHubApp(app, cfg)).rejects.toMatchObject({
        status: 409,
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("reports partial removal and leaves the gateway available for retry", async () => {
    const fetch = vi.fn(
      async (url, init) =>
        new Response("", {
          status: String(url).includes(`/apps/${app}?`)
            ? 503
            : init?.method === "DELETE"
              ? 200
              : 404,
        }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      await deleteFlyHubApp(app, cfg);
      throw Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AppDeletionError);
      expect(error).toMatchObject({ deletedApps: [runtime], status: 502 });
      expect(String(error)).toContain("Fly HTTP 503");
      expect(String(error)).not.toContain(cfg.token);
    }
  });
  it("can retry after the runtime has already been removed", async () => {
    vi.mocked(listAppsByPrefix).mockResolvedValue([app]);
    const fetch = vi.fn(
      async (_url, init) =>
        new Response("", { status: init?.method === "DELETE" ? 200 : 404 }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await deleteFlyHubApp(app, cfg)).toMatchObject({
      deletedApps: [app],
      backupsKept: true,
    });
    expect(
      fetch.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(1);
  });
});
