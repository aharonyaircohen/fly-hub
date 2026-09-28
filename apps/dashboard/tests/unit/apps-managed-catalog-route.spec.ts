import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  packageGET: vi.fn(),
  browserGET: vi.fn(),
  brainGET: vi.fn(),
}));

vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: vi.fn(async () => ({ id: "user-1", label: "Alice" })),
}));
vi.mock("@kody-ade/kody-chat-dashboard/routes/kody/apps", () => ({
  GET: mocks.packageGET,
  POST: vi.fn(),
}));
vi.mock("../../app/api/kody/browser/session/route", () => ({
  GET: mocks.browserGET,
}));
vi.mock("../../app/api/kody/brain/status/route", () => ({
  GET: mocks.brainGET,
}));

describe("Apps managed catalog route", () => {
  beforeEach(() => {
    mocks.packageGET
      .mockReset()
      .mockResolvedValue(
        Response.json({
          apps: [{ appId: "repository-app", name: "Storefront" }],
        }),
      );
    mocks.browserGET
      .mockReset()
      .mockResolvedValue(Response.json({ mode: "remote", state: "idle" }));
    mocks.brainGET
      .mockReset()
      .mockResolvedValue(
        Response.json({ state: "suspended", url: "https://brain.fly.dev" }),
      );
  });

  it("adds Browser and Brain without changing their ownership", async () => {
    const { GET } = await import("../../app/api/kody/apps/route");
    const response = await GET(
      new Request("http://local/api/kody/apps") as never,
    );
    const body = await response.json();

    expect(body.apps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ appId: "repository-app" }),
        expect.objectContaining({
          slug: "browser",
          kind: "browser",
          scope: "repository",
          observedStatus: "idle",
          manageHref: "/preview",
        }),
        expect.objectContaining({
          slug: "brain",
          kind: "brain",
          scope: "personal",
          observedStatus: "suspended",
          manageHref: "/brain",
        }),
      ]),
    );
  });

  it("keeps Apps usable when a managed status read fails", async () => {
    mocks.browserGET.mockRejectedValue(new Error("provider unavailable"));
    const { GET } = await import("../../app/api/kody/apps/route");
    const response = await GET(
      new Request("http://local/api/kody/apps") as never,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.apps.find((app: { slug: string }) => app.slug === "browser"),
    ).toMatchObject({ observedStatus: "unavailable" });
  });
});
