import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const webhook = vi.hoisted(() => ({
  ensureWebhook: vi.fn(),
  provisionBackgroundGitHubAccess: vi.fn(),
  readRecentWebhookDelivery: vi.fn(),
}));

vi.mock("@kody-ade/base/auth/oauth-url", () => ({
  getPublicBaseUrl: vi.fn(() => "http://localhost:3333"),
}));

vi.mock("@dashboard/lib/webhooks/register", () => ({
  ensureWebhook: webhook.ensureWebhook,
}));

vi.mock("@dashboard/lib/webhooks/delivery-store", () => ({
  readRecentWebhookDelivery: webhook.readRecentWebhookDelivery,
}));

vi.mock("@kody-ade/base/auth/background-token-provisioning", () => ({
  provisionBackgroundGitHubAccess: webhook.provisionBackgroundGitHubAccess,
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

async function loadRoute() {
  vi.resetModules();
  return import("@/../app/api/webhooks/register/route");
}

beforeEach(() => {
  vi.clearAllMocks();
  webhook.provisionBackgroundGitHubAccess.mockResolvedValue({
    ok: true,
    source: "encrypted-pat",
  });
  webhook.readRecentWebhookDelivery.mockResolvedValue(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ full_name: "acme/repo" }), {
          status: 200,
        }),
    ),
  );
});

describe("webhook registration route", () => {
  it("reports a local dashboard URL as a setup requirement", async () => {
    webhook.ensureWebhook.mockResolvedValueOnce({
      ok: false,
      skipped: true,
      error: "public_url_required",
    });

    const { POST } = await loadRoute();
    const response = await POST(
      new NextRequest("http://localhost:3333/api/webhooks/register", {
        method: "POST",
        headers: {
          "content-length": "0",
          "x-kody-token": "github_pat_test",
          "x-kody-owner": "acme",
          "x-kody-repo": "repo",
        },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "public_url_required",
      skipped: true,
    });
  });

  it("does not let automatic reconciliation move production hooks from a preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const { POST } = await loadRoute();
    const response = await POST(
      new NextRequest("https://preview.example.com/api/webhooks/register", {
        method: "POST",
        headers: {
          "content-length": "0",
          "x-kody-token": "github_pat_test",
          "x-kody-webhook-reconcile": "automatic",
        },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "preview_environment",
      skipped: true,
    });
    expect(webhook.ensureWebhook).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("repairs background access and accepts a recently delivered hook it cannot manage", async () => {
    webhook.ensureWebhook.mockResolvedValueOnce({
      ok: false,
      error: "list hooks failed",
      status: 404,
    });
    webhook.readRecentWebhookDelivery.mockResolvedValueOnce({
      lastReceivedAt: "2026-08-08T13:56:55.336Z",
      event: "issue_comment",
      deliveryId: "delivery-live",
    });

    const { POST } = await loadRoute();
    const response = await POST(
      new NextRequest("https://dashboard.example.com/api/webhooks/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kody-token": "github_pat_verified",
          "x-kody-owner": "acme",
          "x-kody-repo": "repo",
          "x-kody-webhook-reconcile": "automatic",
        },
        body: JSON.stringify({ owner: "acme", repo: "repo" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      deliveryConfirmed: true,
      webhookManaged: false,
      backgroundAccess: { ok: true, source: "encrypted-pat" },
    });
    expect(webhook.provisionBackgroundGitHubAccess).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      token: "github_pat_verified",
    });
  });

  it("does not require PAT webhook permission when the GitHub App owns access", async () => {
    webhook.provisionBackgroundGitHubAccess.mockResolvedValueOnce({
      ok: true,
      source: "github-app",
    });
    webhook.ensureWebhook.mockResolvedValueOnce({
      ok: false,
      error: "list hooks failed",
      status: 404,
    });

    const { POST } = await loadRoute();
    const response = await POST(
      new NextRequest("https://dashboard.example.com/api/webhooks/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kody-token": "github_pat_verified",
          "x-kody-owner": "acme",
          "x-kody-repo": "repo",
        },
        body: JSON.stringify({ owner: "acme", repo: "repo" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      webhookManaged: false,
      backgroundAccess: { ok: true, source: "github-app" },
    });
  });
});
