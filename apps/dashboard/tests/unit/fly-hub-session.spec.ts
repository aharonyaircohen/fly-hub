import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "../../app/api/fly-hub/session/route";

const origin = "https://flyhub.thedigitalreality.app";
const oldKey = process.env.KODY_MASTER_KEY;

function request(method: string, cookie?: string, body?: unknown, requestOrigin = origin) {
  return new NextRequest(`${origin}/api/fly-hub/session`, {
    method,
    headers: {
      ...(requestOrigin ? { origin: requestOrigin } : {}),
      host: "flyhub.thedigitalreality.app",
      "x-forwarded-proto": "https",
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("Fly Hub remembered token", () => {
  beforeEach(() => {
    process.env.KODY_MASTER_KEY = "11".repeat(32);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: { organizations: { nodes: [{ slug: "personal" }] } },
    })));
  });

  afterEach(() => {
    if (oldKey === undefined) delete process.env.KODY_MASTER_KEY;
    else process.env.KODY_MASTER_KEY = oldKey;
    vi.unstubAllGlobals();
  });

  it("verifies the Fly token and remembers it in an encrypted HttpOnly cookie", async () => {
    const login = await POST(request("POST", undefined, { token: "fly-secret" }));
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ connected: true, orgSlug: "personal" });
    const cookie = login.cookies.get("fly_hub_session");
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.value).not.toContain("fly-secret");
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")).toContain("SameSite=strict");
    expect(login.headers.get("set-cookie")).toContain("Max-Age=2592000");
    const remembered = await GET(request("GET", `fly_hub_session=${cookie!.value}`));
    expect(await remembered.json()).toEqual({ connected: true, orgSlug: "personal" });
    const logout = await DELETE(request("DELETE", `fly_hub_session=${cookie!.value}`));
    expect(logout.cookies.get("fly_hub_session")?.value).toBe("");
  });

  it("rejects invalid tokens and cross-site sign-in", async () => {
    const crossSite = await POST(request("POST", undefined, { token: "fly-secret" }, "https://other.app"));
    expect(crossSite.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 401 })));
    const invalid = await POST(request("POST", undefined, { token: "wrong" }));
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("set-cookie")).toBeNull();
  });
});
