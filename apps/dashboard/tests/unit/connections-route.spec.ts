import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({ owner: "acme", repo: "studio" })),
  verifyActorLogin: vi.fn(),
}));
const store = vi.hoisted(() => ({
  listConnections: vi.fn(),
  readConnection: vi.fn(),
  writeConnection: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@dashboard/lib/connections/store", () => store);
vi.mock("@kody-ade/base/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET, PUT } from "../../app/api/kody/connections/route";

const connection = {
  id: "facebook-main",
  name: "Yair Facebook Page",
  provider: "facebook",
  accountType: "page",
  externalId: "123456789",
  credentialRefs: { accessToken: "FACEBOOK_PAGE_ACCESS_TOKEN" },
  status: "connected" as const,
  verifiedAt: "2026-08-31T12:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.verifyActorLogin.mockResolvedValue({ identity: { login: "alice" } });
  store.listConnections.mockResolvedValue([]);
  store.readConnection.mockResolvedValue(null);
});

describe("Connections API", () => {
  it("lists only public Connection metadata", async () => {
    store.listConnections.mockResolvedValueOnce([connection]);
    const response = await GET(
      new NextRequest("http://localhost/api/kody/connections"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connections: [connection] });
    expect(JSON.stringify(await store.listConnections.mock.results[0]?.value)).not.toContain(
      "secret-value",
    );
  });

  it("saves the exact agreed identity and resets it to needs_attention", async () => {
    const response = await PUT(
      new NextRequest("http://localhost/api/kody/connections", {
        method: "PUT",
        body: JSON.stringify({
          id: "facebook-main",
          name: "Yair Facebook Page",
          provider: "facebook",
          accountType: "page",
          externalId: "123456789",
          credentialRefs: { accessToken: "FACEBOOK_PAGE_ACCESS_TOKEN" },
          actorLogin: "alice",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(store.writeConnection).toHaveBeenCalledWith(
      "acme",
      "studio",
      expect.objectContaining({
        id: "facebook-main",
        status: "needs_attention",
        verifiedAt: null,
      }),
    );
  });

  it("rejects token material and server-owned status", async () => {
    for (const extra of [
      { accessToken: "secret-value" },
      { status: "connected" },
      { verifiedAt: "2026-08-31T12:00:00.000Z" },
    ]) {
      const response = await PUT(
        new NextRequest("http://localhost/api/kody/connections", {
          method: "PUT",
          body: JSON.stringify({
            id: "facebook-main",
            name: "Yair Facebook Page",
            provider: "facebook",
            accountType: "page",
            externalId: "123456789",
            credentialRefs: { accessToken: "FACEBOOK_PAGE_ACCESS_TOKEN" },
            actorLogin: "alice",
            ...extra,
          }),
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(store.writeConnection).not.toHaveBeenCalled();
  });
});
