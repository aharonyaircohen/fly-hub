import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  sync: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoReadAccess: async () => null,
  verifyRepoWriteAccess: async () => null,
  requireKodyAuth: async () => null,
  getRequestAuth: () => ({ owner: "acme", repo: "repo", token: "test" }),
  getUserOctokit: async () => ({}),
}));
vi.mock("@dashboard/lib/repository-loops", () => ({
  listRepositoryLoops: mocks.list,
  readRepositoryLoop: mocks.read,
  saveRepositoryLoop: mocks.save,
  deleteRepositoryLoop: mocks.remove,
}));
vi.mock(
  "@dashboard/features/agency/server/loop-wake-registration",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@dashboard/features/agency/server/loop-wake-registration")
    >()),
    replaceLoopWakeRegistrations: mocks.replace,
    syncLoopWakeRegistration: mocks.sync,
  }),
);
import { GET, POST } from "../../app/api/kody/loops/route";
const loop = {
  id: "hourly",
  trigger: { type: "schedule", every: "1h" },
  target: { kind: "capability", id: "test" },
  input: {},
  enabled: true,
};
it("lists loops without modifying any wake registrations", async () => {
  mocks.list.mockResolvedValue([loop]);
  const response = await GET(
    new NextRequest("https://test.invalid/api/kody/loops"),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).loops).toHaveLength(1);
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
});
describe("retrying a partially saved loop", () => {
  it("retries scheduling an identical saved definition without writing it again", async () => {
    vi.clearAllMocks();
    mocks.read.mockResolvedValue(loop);
    const response = await POST(
      new NextRequest("https://test.invalid/api/kody/loops", {
        method: "POST",
        body: JSON.stringify(loop),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.sync).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      loop,
    });
  });
  it("still rejects a different definition with the same id", async () => {
    vi.clearAllMocks();
    mocks.read.mockResolvedValue({ ...loop, enabled: false });
    const response = await POST(
      new NextRequest("https://test.invalid/api/kody/loops", {
        method: "POST",
        body: JSON.stringify(loop),
      }),
    );
    expect(response.status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});

it("reports a saved definition whose schedule could not synchronize as retryable", async () => {
  vi.clearAllMocks();
  const { LoopWakeSyncError } =
    await import("@dashboard/features/agency/server/loop-wake-registration");
  mocks.read.mockResolvedValue(null);
  mocks.sync.mockRejectedValueOnce(new LoopWakeSyncError());
  const response = await POST(
    new NextRequest("https://test.invalid/api/kody/loops", {
      method: "POST",
      body: JSON.stringify(loop),
    }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    error: "loop_schedule_sync_failed",
  });
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it("reports a deleted definition with failed schedule removal and permits retry", async () => {
  vi.clearAllMocks();
  const { DELETE } = await import("../../app/api/kody/loops/[id]/route");
  const { LoopWakeSyncError } =
    await import("@dashboard/features/agency/server/loop-wake-registration");
  mocks.sync.mockRejectedValueOnce(new LoopWakeSyncError());
  const request = () =>
    new NextRequest("https://test.invalid/api/kody/loops/hourly", {
      method: "DELETE",
    });
  const params = { params: Promise.resolve({ id: "hourly" }) };
  const failed = await DELETE(request(), params);
  expect(failed.status).toBe(503);
  expect(await failed.json()).toMatchObject({
    error: "loop_schedule_sync_failed",
  });
  expect(mocks.remove).toHaveBeenCalledTimes(1);
  expect((await DELETE(request(), params)).status).toBe(200);
  expect(mocks.sync).toHaveBeenLastCalledWith({
    owner: "acme",
    repo: "repo",
    loopId: "hourly",
  });
});
