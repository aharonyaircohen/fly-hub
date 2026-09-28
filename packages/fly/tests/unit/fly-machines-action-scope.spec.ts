import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  suspend: vi.fn(), start: vi.fn(), destroy: vi.fn(), destroyApp: vi.fn(),
}));
vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: vi.fn().mockResolvedValue(null),
  verifyActorLogin: vi.fn().mockResolvedValue({ identity: { login: "alice" } }),
}));
vi.mock("../../src/infrastructure/server-context", () => ({
  resolveServerProviderContext: vi.fn().mockResolvedValue({
    ok: true, context: { owner: "alice", repo: "one" },
  }),
  serverProviderConfigFromContext: vi.fn().mockReturnValue({
    token: "secret", orgSlug: "personal", defaultRegion: "fra",
  }),
}));
vi.mock("../../src/infrastructure/server-machines", () => ({
  suspendMachine: mocks.suspend,
  startServerProviderMachine: mocks.start,
  destroyMachine: mocks.destroy,
  destroyApp: mocks.destroyApp,
}));
import { POST } from "../../src/routes/fly-machines-action";
import { managedMachineAppName } from "../../src/machines/managed";

beforeEach(() => vi.clearAllMocks());

it("rejects actions against another repository's Fly Hub app", async () => {
  const otherApp = managedMachineAppName("alice", "two", "personal");
  const response = await POST(new NextRequest("http://localhost/api/kody/fly/machines/action", {
    method: "POST",
    body: JSON.stringify({ app: otherApp, machineId: "machine-1", action: "destroy" }),
  }));
  expect(response.status).toBe(404);
  expect(mocks.destroy).not.toHaveBeenCalled();
});

it("allows actions against the selected repository's Fly Hub app", async () => {
  const app = managedMachineAppName("alice", "one", "personal");
  const response = await POST(new NextRequest("http://localhost/api/kody/fly/machines/action", {
    method: "POST",
    body: JSON.stringify({ app, machineId: "machine-1", action: "suspend" }),
  }));
  expect(response.status).toBe(200);
  expect(mocks.suspend).toHaveBeenCalledOnce();
});

it.each([
  ["start", "start"],
  ["destroy", "destroy"],
] as const)("dispatches %s to the selected machine", async (action, method) => {
  const app = managedMachineAppName("alice", "one", "personal");
  const response = await POST(new NextRequest("http://localhost/api/kody/fly/machines/action", {
    method: "POST",
    body: JSON.stringify({ app, machineId: "machine-1", action }),
  }));
  expect(response.status).toBe(200);
  expect(mocks[method]).toHaveBeenCalledWith(app, "machine-1", expect.anything());
});
