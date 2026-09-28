import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  inventory: vi.fn(),
  create: vi.fn(),
  suspend: vi.fn(),
}));
vi.mock("../../src/infrastructure/server-machines", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listServerProviderInventory: mocks.inventory,
  suspendMachine: mocks.suspend,
}));
vi.mock("../../src/machines/managed", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createManagedMachine: mocks.create,
}));

import { setHubSession } from "../../src/hub/session";
import { GET, POST } from "../../src/hub/machines";
import { POST as action } from "../../src/hub/machine-action";

const origin = "https://flyhub.thedigitalreality.app";
const oldKey = process.env.KODY_MASTER_KEY;
const machine = { app: "flyhub-test", machineId: "abc123", state: "started" };

function request(path: string, method = "GET", cookie?: string, body?: unknown) {
  return new NextRequest(origin + path, {
    method,
    headers: {
      host: "flyhub.thedigitalreality.app",
      origin,
      "x-forwarded-proto": "https",
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function sessionCookie() {
  const response = NextResponse.json({});
  setHubSession(response, { token: "fly-secret", orgSlug: "personal" });
  return `fly_hub_session=${response.cookies.get("fly_hub_session")!.value}`;
}

describe("Fly Hub machine routes", () => {
  beforeEach(() => {
    process.env.KODY_MASTER_KEY = "22".repeat(32);
    mocks.inventory.mockResolvedValue({ machines: [machine], total: 1, running: 1 });
    mocks.create.mockResolvedValue({ ...machine, region: "fra" });
    mocks.suspend.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.clearAllMocks();
    if (oldKey === undefined) delete process.env.KODY_MASTER_KEY;
    else process.env.KODY_MASTER_KEY = oldKey;
  });

  it("requires the remembered Fly session before listing machines", async () => {
    expect((await GET(request("/api/kody/fly/machines"))).status).toBe(401);
    const response = await GET(request("/api/kody/fly/machines", "GET", sessionCookie()));
    expect(response.status).toBe(200);
    expect((await response.json()).machines).toEqual([machine]);
    expect(mocks.inventory).toHaveBeenCalledWith({
      token: "fly-secret", orgSlug: "personal", defaultRegion: "iad",
    });
  });

  it("creates with the chosen machine settings and token org", async () => {
    const body = { name: "My machine", size: "high", region: "fra", sleepWhenIdle: false,
      requestId: "a4e43d24-7d03-4d7f-a1b1-7e4442a8d2df" };
    const response = await POST(request("/api/kody/fly/machines", "POST", sessionCookie(), body));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      ...body, owner: "flyhub", repo: "machines",
      cfg: { token: "fly-secret", orgSlug: "personal", defaultRegion: "iad" },
    });
  });

  it("only acts on machines visible to the Fly token", async () => {
    const cookie = sessionCookie();
    const missing = await action(request("/api/kody/fly/machines/action", "POST", cookie,
      { app: "another-app", machineId: "abc123", action: "suspend" }));
    expect(missing.status).toBe(404);
    expect(mocks.suspend).not.toHaveBeenCalled();
    const allowed = await action(request("/api/kody/fly/machines/action", "POST", cookie,
      { app: "flyhub-test", machineId: "abc123", action: "suspend" }));
    expect(allowed.status).toBe(200);
    expect(mocks.suspend).toHaveBeenCalledWith("flyhub-test", "abc123", {
      token: "fly-secret", orgSlug: "personal", defaultRegion: "iad",
    });
  });
});
