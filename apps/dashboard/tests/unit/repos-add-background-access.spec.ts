import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  ensureWebhook: vi.fn(),
  provisionBackgroundGitHubAccess: vi.fn(),
  readRecentWebhookDelivery: vi.fn(),
}));

vi.mock("@dashboard/lib/webhooks/register", () => ({
  ensureWebhook: dependencies.ensureWebhook,
}));

vi.mock("@kody-ade/base/auth/background-token-provisioning", () => ({
  provisionBackgroundGitHubAccess: dependencies.provisionBackgroundGitHubAccess,
}));

vi.mock("@dashboard/lib/webhooks/delivery-store", () => ({
  readRecentWebhookDelivery: dependencies.readRecentWebhookDelivery,
}));

vi.mock("@kody-ade/base/auth/oauth-url", () => ({
  getPublicBaseUrl: vi.fn(() => "https://dashboard.example.com"),
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { POST } from "../../app/api/kody/repos/add/route";

function request(token = "github_pat_verified") {
  return new NextRequest("https://dashboard.example.com/api/kody/repos/add", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner: "acme", repo: "widgets", token }),
  });
}

describe("POST /api/kody/repos/add background access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.provisionBackgroundGitHubAccess.mockResolvedValue({
      ok: true,
      source: "encrypted-pat",
    });
    dependencies.ensureWebhook.mockResolvedValue({
      ok: true,
      created: false,
      hookId: 42,
    });
    dependencies.readRecentWebhookDelivery.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const value = String(url);
        if (value.endsWith("/repos/acme/widgets")) {
          return new Response(
            JSON.stringify({
              full_name: "acme/widgets",
              private: true,
              default_branch: "main",
              html_url: "https://github.com/acme/widgets",
            }),
            { status: 200 },
          );
        }
        if (value.endsWith("/user")) {
          return new Response(
            JSON.stringify({ login: "alice", avatar_url: "avatar", id: 1 }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );
  });

  it("provisions encrypted background access before completing connection", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.backgroundAccess).toEqual({
      ok: true,
      source: "encrypted-pat",
    });
    expect(dependencies.provisionBackgroundGitHubAccess).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      token: "github_pat_verified",
      actorLogin: "alice",
    });
    expect(JSON.stringify(body)).not.toContain("github_pat_verified");
  });

  it("does not complete connection without durable background access", async () => {
    dependencies.provisionBackgroundGitHubAccess.mockResolvedValue({
      ok: false,
      reason: "credential-store-not-configured",
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "background_access_unavailable",
      message: "Secure background GitHub access is not configured.",
    });
    expect(dependencies.ensureWebhook).not.toHaveBeenCalled();
  });

  it("does not add a duplicate repository webhook when the GitHub App owns delivery", async () => {
    dependencies.provisionBackgroundGitHubAccess.mockResolvedValue({
      ok: true,
      source: "github-app",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      webhook: { ok: true },
      backgroundAccess: { ok: true, source: "github-app" },
    });
    expect(dependencies.ensureWebhook).not.toHaveBeenCalled();
  });

  it("accepts an existing recently delivered webhook the PAT cannot manage", async () => {
    dependencies.ensureWebhook.mockResolvedValue({
      ok: false,
      error: "list hooks failed",
      status: 404,
    });
    dependencies.readRecentWebhookDelivery.mockResolvedValue({
      lastReceivedAt: "2026-08-08T13:56:55.336Z",
      event: "issue_comment",
      deliveryId: "delivery-live",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      webhook: { ok: true, created: false },
      backgroundAccess: { ok: true, source: "encrypted-pat" },
    });
  });
});
