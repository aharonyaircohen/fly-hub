import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), actor: vi.fn(), context: vi.fn(), cfg: vi.fn(),
  create: vi.fn(), appName: vi.fn(), visible: vi.fn(),
}));
vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: mocks.auth,
  verifyActorLogin: mocks.actor,
}));
vi.mock("@kody-ade/base/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../../src/infrastructure/server-context", () => ({
  resolveServerProviderContext: mocks.context,
  serverProviderConfigFromContext: mocks.cfg,
}));
vi.mock("../../src/infrastructure/server-brain", () => ({
  emptyServerProviderInventory: () => ({ machines: [], total: 0, running: 0 }),
  listServerProviderInventoryCached: vi.fn(),
  refreshServerProviderInventoryCounts: vi.fn(),
}));
vi.mock("../../src/machines/managed", () => ({
  createManagedMachine: mocks.create,
  managedMachineAppName: mocks.appName,
  visibleManagedInventory: mocks.visible,
}));
import { POST } from "../../src/routes/fly-machines";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/kody/fly/machines", {
    method: "POST", body: JSON.stringify(body),
  });
}
const valid = {
  name: "My machine", size: "medium", region: "ams", sleepWhenIdle: true,
  requestId: "f972134a-1b3e-462a-8cda-20165967f9c7",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.actor.mockResolvedValue({ identity: { login: "alice" } });
  mocks.context.mockResolvedValue({ ok: true, context: { owner: "alice", repo: "demo" } });
  mocks.cfg.mockReturnValue({ token: "secret", orgSlug: "personal", defaultRegion: "fra" });
  mocks.create.mockResolvedValue({ app: "flyhub-test", machineId: "abc123", region: "ams", state: "started" });
});

it("creates a machine from validated user settings and repository context", async () => {
  const response = await POST(request(valid));
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ machineId: "abc123" });
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
    ...valid, owner: "alice", repo: "demo", cfg: expect.objectContaining({ token: "secret" }),
  }));
});

it("rejects invalid settings before contacting Fly", async () => {
  expect((await POST(request({ ...valid, name: "" }))).status).toBe(400);
  expect((await POST(request({ ...valid, size: "giant" }))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});

it("requires authentication and the repository Fly token", async () => {
  mocks.auth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
  expect((await POST(request(valid))).status).toBe(401);
  mocks.cfg.mockReturnValueOnce(null);
  expect((await POST(request(valid))).status).toBe(503);
  expect(mocks.create).not.toHaveBeenCalled();
});

it("does not expose provider errors that might contain credentials", async () => {
  mocks.create.mockRejectedValue(new Error("private Fly token"));
  const response = await POST(request(valid));
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("private Fly token");
});
