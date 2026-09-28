import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  actor: vi.fn(),
  context: vi.fn(),
  cfg: vi.fn(),
  inventory: vi.fn(),
  targetCfg: vi.fn(),
  machines: vi.fn(),
  access: vi.fn(),
  archive: vi.fn(),
}));
vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: mocks.auth,
  verifyActorLogin: mocks.actor,
}));
vi.mock("../../src/infrastructure/server-context", () => ({
  resolveServerProviderContext: mocks.context,
  serverProviderConfigFromContext: mocks.cfg,
}));
vi.mock("../../src/terminal/server-inventory", () => ({
  loadTerminalInventoryAuthority: mocks.inventory,
  terminalFlyConfigForMachine: mocks.targetCfg,
}));
vi.mock("../../src/plugin/previews/machines-client", () => ({
  listMachines: mocks.machines,
}));
vi.mock("../../src/ssh/machine-config", () => ({
  readMachineSshAccess: mocks.access,
  sshPorts: (config: { services?: { ports: { port: number }[] }[] }) =>
    config.services?.flatMap((s) => s.ports.map((p) => p.port)) ?? [],
}));
vi.mock("../../src/ssh/archive", () => ({ machineSshArchive: mocks.archive }));
import { POST } from "../../src/routes/fly-machines-ssh";
function request(body: unknown = { app: "test-app", machineId: "abc123" }) {
  return new NextRequest("http://localhost/api/kody/fly/machines/ssh", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.actor.mockResolvedValue({ identity: { login: "alice" } });
  mocks.context.mockResolvedValue({ ok: true, context: {} });
  mocks.cfg.mockReturnValue({ token: "private-token" });
  mocks.inventory.mockResolvedValue({
    inventory: {
      machines: [{ app: "test-app", machineId: "abc123", feature: "preview" }],
    },
    savedBrain: null,
  });
  mocks.machines.mockResolvedValue([{ id: "abc123", config: {} }]);
  mocks.access.mockReturnValue({ port: 23001 });
  mocks.archive.mockReturnValue({
    filename: "kody-test-app-abc123.zip",
    bytes: new Uint8Array([1, 2, 3]),
  });
});
describe("SSH credential download", () => {
  it("requires authentication before accessing any machine", async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(request())).status).toBe(401);
    expect(mocks.machines).not.toHaveBeenCalled();
  });
  it("requires a verified actor", async () => {
    mocks.actor.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await POST(request())).status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("rejects malformed targets", async () => {
    expect(
      (await POST(request({ app: "bad\nHost *", machineId: "abc123" }))).status,
    ).toBe(400);
    expect(mocks.inventory).not.toHaveBeenCalled();
  });
  it("does not decrypt a machine outside the authorized inventory", async () => {
    mocks.inventory.mockResolvedValue({
      inventory: { machines: [] },
      savedBrain: null,
    });
    expect((await POST(request())).status).toBe(404);
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("does not export another user's browser key", async () => {
    mocks.inventory.mockResolvedValue({
      inventory: {
        machines: [
          { app: "test-app", machineId: "abc123", feature: "browser" },
        ],
      },
      savedBrain: null,
    });
    mocks.machines.mockResolvedValue([
      { id: "abc123", config: { env: { KODY_BROWSER_ACTOR_ID: "bob" } } },
    ]);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("rejects Brain machines outside the user's saved Brain", async () => {
    mocks.inventory.mockResolvedValue({
      inventory: {
        machines: [{ app: "test-app", machineId: "abc123", feature: "brain" }],
      },
      savedBrain: null,
    });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("reports old machines without generating new credentials", async () => {
    mocks.access.mockReturnValue(null);
    expect((await POST(request())).status).toBe(409);
    expect(mocks.archive).not.toHaveBeenCalled();
  });
  it("fails closed when another machine uses the same external port", async () => {
    mocks.machines.mockResolvedValue([
      { id: "abc123", config: {} },
      { id: "def456", config: { services: [{ ports: [{ port: 23001 }] }] } },
    ]);
    expect((await POST(request())).status).toBe(409);
    expect(mocks.archive).not.toHaveBeenCalled();
  });
  it("downloads an attachment without caching credentials", async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("no-store, private");
    expect(result.headers.get("Content-Disposition")).toBe(
      'attachment; filename="kody-test-app-abc123.zip"',
    );
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3]);
  });
  it("does not expose provider or decryption errors", async () => {
    mocks.access.mockImplementation(() => {
      throw new Error("private-token secret");
    });
    const result = await POST(request());
    expect(result.status).toBe(500);
    expect(await result.text()).not.toContain("private-token");
  });
});
