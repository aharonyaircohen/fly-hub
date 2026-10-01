import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { setHubSession } from "@kody-ade/fly/hub/session";
import { DELETE } from "../../app/api/fly-hub/apps/[app]/route";
import { AppDeletionError } from "@kody-ade/fly/hub/app-management";
const { remove } = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("@kody-ade/fly/hub/app-management", async (original) => ({
  ...(await original<typeof import("@kody-ade/fly/hub/app-management")>()),
  deleteFlyHubApp: remove,
}));
const origin = "https://flyhub.example";
const app = "flyhub-app-test-123456789abc";
const context = { params: Promise.resolve({ app }) };
function request(confirmApp = app, signedIn = true, sameOrigin = true) {
  const response = NextResponse.json({});
  if (signedIn)
    setHubSession(response, { token: "secret", orgSlug: "personal" });
  return new NextRequest(`${origin}/api/fly-hub/apps/${app}`, {
    method: "DELETE",
    headers: {
      host: new URL(origin).host,
      ...(sameOrigin ? { origin } : {}),
      cookie: response.cookies
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join("; "),
      "content-type": "application/json",
    },
    body: JSON.stringify({ confirmApp }),
  });
}
beforeEach(() => {
  process.env.KODY_MASTER_KEY = "44".repeat(32);
  remove
    .mockReset()
    .mockResolvedValue({ deletedApps: [app], backupsKept: true });
});
describe("app deletion authorization", () => {
  it("requires sign-in, same-origin request, and confirmation of the selected app", async () => {
    expect((await DELETE(request(app, false), context)).status).toBe(401);
    expect((await DELETE(request(app, true, false), context)).status).toBe(403);
    expect((await DELETE(request("another-app"), context)).status).toBe(400);
    expect(remove).not.toHaveBeenCalled();
    const result = await DELETE(request(), context);
    expect(result.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(
      app,
      expect.objectContaining({ token: "secret", orgSlug: "personal" }),
    );
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it("returns the failed step and completed removals for a partial deletion", async () => {
    remove.mockRejectedValue(
      new AppDeletionError("Gateway removal failed", 502, ["runtime"]),
    );
    const result = await DELETE(request(), context);
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({
      error: "Gateway removal failed",
      deletedApps: ["runtime"],
    });
  });
});
