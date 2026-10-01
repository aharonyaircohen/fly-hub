import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { setHubSession } from "@kody-ade/fly/hub/session";
import {
  setRegistrySession,
  readRegistrySession,
} from "../../src/dashboard/lib/fly-hub-registry-session";
import { GET, POST, DELETE } from "../../app/api/fly-hub/apps/saved/route";
import { POST as connectRegistry } from "../../app/api/fly-hub/registry/route";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  jobs: vi.fn(),
  start: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@kody-ade/fly/hub/saved-apps", () => ({
  listSavedApps: mocks.list,
  savedAppJobs: mocks.jobs,
  startSavedAppJob: mocks.start,
  deleteSavedApp: mocks.remove,
}));
const origin = "https://flyhub.example";
function request(body?: unknown, withRegistry = true, withOrigin = true) {
  const response = NextResponse.json({});
  setHubSession(response, { token: "fly-token", orgSlug: "personal" });
  if (withRegistry)
    setRegistrySession(response, {
      user: "owner",
      token: "private-registry-token",
    });
  return new NextRequest(`${origin}/api/fly-hub/apps/saved`, {
    method: body ? "POST" : "GET",
    headers: {
      host: new URL(origin).host,
      cookie: response.cookies
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join("; "),
      ...(withOrigin ? { origin } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  process.env.KODY_MASTER_KEY = "44".repeat(32);
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.jobs.mockResolvedValue([]);
  mocks.start.mockResolvedValue({ jobId: "worker-1", status: "working" });
});
describe("FlyHub saved app endpoints", () => {
  it("requires Fly sign-in, registry connection, and same-origin writes", async () => {
    expect(
      (await GET(new NextRequest(`${origin}/api/fly-hub/apps/saved`))).status,
    ).toBe(401);
    expect(
      (await POST(request({ action: "save", app: "test" }, false))).status,
    ).toBe(401);
    expect(
      (await POST(request({ action: "save", app: "test" }, true, false)))
        .status,
    ).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("encrypts registry credentials and never returns them in the catalog", async () => {
    const req = request();
    expect(req.headers.get("cookie")).not.toContain("private-registry-token");
    expect(readRegistrySession(req)).toEqual({
      user: "owner",
      token: "private-registry-token",
    });
    const result = await GET(req);
    expect(await result.json()).toEqual({ saved: [], jobs: [] });
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it("passes only authenticated Fly and GitHub credentials to the save job", async () => {
    const result = await POST(
      request({ action: "save", app: "flyhub-app-test-123456789abc" }),
    );
    expect(result.status).toBe(202);
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ token: "fly-token", orgSlug: "personal" }),
      { user: "owner", token: "private-registry-token" },
      { action: "save", app: "flyhub-app-test-123456789abc" },
    );
  });
  it("rejects unsupported actions before creating machines", async () => {
    expect(
      (await POST(request({ action: "delete", app: "test" }))).status,
    ).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("requires same-origin confirmation and registry access before deleting a version", async () => {
    const id = "a".repeat(32);
    expect(
      (await DELETE(request({ id, confirmId: id }, true, false))).status,
    ).toBe(403);
    expect((await DELETE(request({ id, confirmId: id }, false))).status).toBe(
      401,
    );
    expect((await DELETE(request({ id, confirmId: "wrong" }))).status).toBe(
      400,
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    expect((await DELETE(request({ id, confirmId: id }))).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.objectContaining({ orgSlug: "personal" }),
      { user: "owner", token: "private-registry-token" },
      id,
    );
  });
  it("rejects GitHub credentials without registry write permission", async () => {
    const original = global.fetch;
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ login: "owner" }), {
          headers: { "x-oauth-scopes": "repo" },
        }),
    ) as typeof fetch;
    try {
      const result = await connectRegistry(
        request({ token: "github-token-without-package-scope" }, false),
      );
      expect(result.status).toBe(400);
      expect(result.cookies.get("fly_hub_registry")).toBeUndefined();
    } finally {
      global.fetch = original;
    }
  });
});
