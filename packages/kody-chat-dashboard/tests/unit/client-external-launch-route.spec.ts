import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  resolveClientBrand: vi.fn(),
  resolveExternalIdentityConfig: vi.fn(),
  verifyExternalLaunchAssertion: vi.fn(),
  mintClientSession: vi.fn(),
  checkExternalLaunchRateLimit: vi.fn(),
}));

vi.mock("../../src/dashboard/lib/client-brand", () => ({
  resolveClientBrand: h.resolveClientBrand,
}));
vi.mock("../../src/dashboard/lib/client-session/external-identity", () => ({
  resolveExternalIdentityConfig: h.resolveExternalIdentityConfig,
  verifyExternalLaunchAssertion: h.verifyExternalLaunchAssertion,
}));
vi.mock("../../src/dashboard/lib/client-session/session", () => ({
  CLIENT_SESSION_COOKIE: "kody_client_session",
  CLIENT_SESSION_TTL_SEC: 14_400,
  EXTERNAL_CLIENT_SESSION_TTL_SEC: 1_800,
  mintClientSession: h.mintClientSession,
}));
vi.mock("../../src/dashboard/lib/client-session/rate-limit", () => ({
  checkExternalLaunchRateLimit: h.checkExternalLaunchRateLimit,
}));

import { POST } from "../../app/api/client-session/external-launch/route";

function request(body: Record<string, unknown>) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    form.set(key, String(value));
  }
  return new NextRequest(
    "https://dashboard.example/api/client-session/external-launch",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    },
  );
}

describe("POST /api/client-session/external-launch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.resolveClientBrand.mockResolvedValue({
      slug: "acme",
      name: "Acme",
      accent: "#0f766e",
      access: { mode: "delegated" },
    });
    h.resolveExternalIdentityConfig.mockResolvedValue({
      issuer: "https://identity.example",
      audience: "kody-brand-chat",
      jwksUrl: "https://identity.example/.well-known/jwks.json",
    });
    h.verifyExternalLaunchAssertion.mockResolvedValue({
      subject: "user-123",
      kind: "external",
    });
    h.mintClientSession.mockResolvedValue("signed-session");
    h.checkExternalLaunchRateLimit.mockResolvedValue(true);
  });

  it("exchanges a browser form assertion and redirects into Chat", async () => {
    const response = await POST(
      request({
        assertion: "host-jwt-with-enough-length",
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://dashboard.example/client/A-Guy-educ/A-Guy-Teacher/acme",
    );
    expect(h.mintClientSession).toHaveBeenCalledWith(
      {
        identity: {
          subject: "user-123",
          kind: "external",
        },
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
      },
      { ttlSec: 1_800 },
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("kody_client_session=signed-session");
    expect(cookie).toContain("Max-Age=1800");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
  });

  it("rejects JSON so integrations use the browser navigation contract", async () => {
    const response = await POST(
      new NextRequest(
        "https://dashboard.example/api/client-session/external-launch",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assertion: "host-jwt-with-enough-length",
            owner: "A-Guy-educ",
            repo: "A-Guy-Teacher",
            brandSlug: "acme",
          }),
        },
      ),
    );

    expect(response.status).toBe(415);
    expect(h.resolveClientBrand).not.toHaveBeenCalled();
  });

  it("rejects an incomplete browser form", async () => {
    const response = await POST(request({ owner: "A-Guy-educ" }));

    expect(response.status).toBe(400);
    expect(h.checkExternalLaunchRateLimit).not.toHaveBeenCalled();
  });

  it("does not accept host identity for a public brand", async () => {
    h.resolveClientBrand.mockResolvedValue({
      slug: "acme",
      name: "Acme",
      accent: "#0f766e",
      access: { mode: "public" },
    });

    const response = await POST(
      request({
        assertion: "host-jwt-with-enough-length",
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
      }),
    );

    expect(response.status).toBe(409);
    expect(h.verifyExternalLaunchAssertion).not.toHaveBeenCalled();
  });

  it("rejects launches over the shared rate limit", async () => {
    h.checkExternalLaunchRateLimit.mockResolvedValue(false);

    const response = await POST(
      request({
        assertion: "host-jwt-with-enough-length",
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
      }),
    );

    expect(response.status).toBe(429);
    expect(h.resolveClientBrand).not.toHaveBeenCalled();
    expect(h.verifyExternalLaunchAssertion).not.toHaveBeenCalled();
  });

  it("fails closed when shared rate-limit state is unavailable", async () => {
    h.checkExternalLaunchRateLimit.mockRejectedValue(
      new Error("Convex unavailable"),
    );

    const response = await POST(
      request({
        assertion: "host-jwt-with-enough-length",
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
      }),
    );

    expect(response.status).toBe(503);
    expect(h.resolveClientBrand).not.toHaveBeenCalled();
    expect(h.mintClientSession).not.toHaveBeenCalled();
  });

  it("returns not found without verifying identity when the brand is missing", async () => {
    h.resolveClientBrand.mockResolvedValue(null);

    const response = await POST(
      request({
        assertion: "host-jwt-with-enough-length",
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
      }),
    );

    expect(response.status).toBe(404);
    expect(h.verifyExternalLaunchAssertion).not.toHaveBeenCalled();
  });

  it("fails closed when the repository has no identity contract", async () => {
    h.resolveExternalIdentityConfig.mockResolvedValue(null);

    const response = await POST(
      request({
        assertion: "host-jwt-with-enough-length",
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
      }),
    );

    expect(response.status).toBe(503);
    expect(h.verifyExternalLaunchAssertion).not.toHaveBeenCalled();
  });

  it("rejects an invalid host assertion without creating a session", async () => {
    h.verifyExternalLaunchAssertion.mockRejectedValue(
      new Error("Invalid signature"),
    );

    const response = await POST(
      request({
        assertion: "host-jwt-with-enough-length",
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
        brandSlug: "acme",
      }),
    );

    expect(response.status).toBe(401);
    expect(h.mintClientSession).not.toHaveBeenCalled();
  });
});
