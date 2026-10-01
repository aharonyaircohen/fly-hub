import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestAppCancellation,
  isAppTaskCancelled,
} from "../../src/hub/app-cancellation";
import { getPreviewBuilderStatus } from "../../src/previews/builder-client";
const mocks = vi.hoisted(() => ({ machines: vi.fn() }));
vi.mock("../../src/plugin/previews/machines-client", () => ({
  listMachines: mocks.machines,
}));
const cfg = {
  token: "private-token",
  orgSlug: "personal",
  defaultRegion: "iad",
};
const appName = "flyhub-app-test-123456789abc";
const worker = {
  id: "123456789abc",
  state: "started",
  config: {
    env: { APP_TASK_ID: "task-1" },
    metadata: {
      flyhub_build_app: appName,
      flyhub_build_org: "personal",
      flyhub_build_kind: "app",
    },
  },
};
beforeEach(() => {
  vi.stubEnv("FLY_HUB_BUILDER_IMAGE", "builder-image");
  vi.clearAllMocks();
  mocks.machines.mockResolvedValue([worker]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("app cancellation", () => {
  it("creates a non-running, credential-free revocation record for the exact worker and task", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "marker" }));
    vi.stubGlobal("fetch", fetch);
    expect(
      await requestAppCancellation({ cfg, appName, workerId: worker.id }),
    ).toMatchObject({ status: "cancelling", workers: [worker.id] });
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({
      skip_launch: true,
      config: {
        env: {},
        metadata: {
          flyhub_cancel_org: "personal",
          flyhub_cancel_worker: worker.id,
          flyhub_cancel_task: "task-1",
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("private-token");
  });
  it("rejects another organization's worker before sending cancellation", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      requestAppCancellation({
        cfg: { ...cfg, orgSlug: "other" },
        appName,
        workerId: worker.id,
      }),
    ).rejects.toThrow("not found");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves an already completed app and does not kill its worker", async () => {
    mocks.machines.mockResolvedValue([
      {
        ...worker,
        config: {
          ...worker.config,
          metadata: {
            ...worker.config.metadata,
            flyhub_build_status: "completed",
          },
        },
      },
    ]);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await requestAppCancellation({ cfg, appName, workerId: worker.id }),
    ).toMatchObject({ status: "finished" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("revokes an agent task before a deployment worker exists", async () => {
    mocks.machines.mockResolvedValue([]);
    const fetch = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetch);
    expect(
      await requestAppCancellation({ cfg, appName, taskId: "task-1" }),
    ).toMatchObject({ status: "cancelled" });
    const metadata = JSON.parse(fetch.mock.calls[0]![1]!.body as string).config
      .metadata;
    mocks.machines.mockResolvedValue([{ config: { metadata } }]);
    expect(await isAppTaskCancelled("task-1", cfg)).toBe(true);
    expect(await isAppTaskCancelled("task-2", cfg)).toBe(false);
    expect(
      await isAppTaskCancelled("task-1", { ...cfg, orgSlug: "other" }),
    ).toBe(false);
  });
  it("reports cancelling without clearing credentials needed for rollback", async () => {
    const fetch = vi.fn(async () =>
      Response.json([
        { ...worker, created_at: new Date().toISOString() },
        {
          config: {
            metadata: {
              flyhub_cancel_org: "personal",
              flyhub_cancel_worker: worker.id,
            },
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await getPreviewBuilderStatus(appName, "private-token", "host"),
    ).toMatchObject({
      state: "cancelling",
      machineId: worker.id,
      taskId: "task-1",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
