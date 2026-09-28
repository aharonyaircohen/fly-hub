import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getRequestAuth: vi.fn(),
  verifyActorLogin: vi.fn(),
  resolveClientBrand: vi.fn(),
  mintClientSession: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  getRequestAuth: h.getRequestAuth,
  verifyActorLogin: h.verifyActorLogin,
}));
vi.mock("../../src/dashboard/lib/client-brand", () => ({
  resolveClientBrand: h.resolveClientBrand,
}));
vi.mock("../../src/dashboard/lib/client-session/session", () => ({
  CLIENT_SESSION_COOKIE: "kody_client_session",
  CLIENT_SESSION_TTL_SEC: 14_400,
  mintClientSession: h.mintClientSession,
}));

import { POST } from "../../app/api/client-session/dashboard-launch/route";

function request(body: Record<string, unknown>) {
  return new NextRequest(
    "https://dashboard.example/api/client-session/dashboard-launch",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kody-token": "token",
        "x-kody-owner": "A-Guy-educ",
        "x-kody-repo": "A-Guy-Teacher",
        "x-kody-user-login": "aguy",
      },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/client-session/dashboard-launch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getRequestAuth.mockReturnValue({
      token: "token",
      owner: "A-Guy-educ",
      repo: "A-Guy-Teacher",
      userLogin: "aguy",
    });
    h.verifyActorLogin.mockResolvedValue({
      identity: {
        login: "aguy",
        avatar_url: "https://avatars.example/aguy",
        githubId: 123,
      },
    });
    h.resolveClientBrand.mockResolvedValue({
      slug: "acme",
      name: "Acme",
      accent: "#0f766e",
      locale: "en",
      access: { mode: "delegated" },
    });
    h.mintClientSession.mockResolvedValue("signed-session");
  });

  it("verifies the Dashboard actor and creates an HttpOnly scoped session", async () => {
    const response = await POST(
      request({
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "/client/A-Guy-educ/A-Guy-Teacher/acme",
    });
    expect(h.mintClientSession).toHaveBeenCalledWith({
      identity: {
        subject: "github:123",
        kind: "operator",
        name: "aguy",
        image: "https://avatars.example/aguy",
      },
      owner: "A-Guy-educ",
      repo: "A-Guy-Teacher",
      brandSlug: "acme",
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("kody_client_session=signed-session");
    expect(cookie).toContain("HttpOnly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it("rejects a launch for a different repository", async () => {
    const response = await POST(
      request({
        owner: "other",
        repo: "repo",
        brandSlug: "acme",
      }),
    );

    expect(response.status).toBe(403);
    expect(h.verifyActorLogin).not.toHaveBeenCalled();
    expect(h.mintClientSession).not.toHaveBeenCalled();
  });

  it("returns a delegated brand lookup failure instead of creating a session", async () => {
    h.resolveClientBrand.mockRejectedValue(new Error("Convex unavailable"));

    const response = await POST(
      request({
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
      }),
    );

    expect(response.status).toBe(503);
    expect(h.mintClientSession).not.toHaveBeenCalled();
  });

  it("does not create a redundant session for a public brand", async () => {
    h.resolveClientBrand.mockResolvedValue({
      slug: "acme",
      name: "Acme",
      accent: "#0f766e",
      locale: "en",
      access: { mode: "public" },
    });

    const response = await POST(
      request({
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "brand_does_not_require_delegated_access",
    });
    expect(h.mintClientSession).not.toHaveBeenCalled();
  });
});
