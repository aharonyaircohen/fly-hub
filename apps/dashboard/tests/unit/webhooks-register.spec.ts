import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureWebhook } from "@dashboard/lib/webhooks/register";

describe("ensureWebhook", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    "http://localhost:3333/api/webhooks/github",
    "https://127.0.0.1/api/webhooks/github",
    "https://100.64.0.1/api/webhooks/github",
    "https://192.0.2.1/api/webhooks/github",
    "https://[::1]/api/webhooks/github",
    "https://[fd00::1]/api/webhooks/github",
    "https://[fe80::1]/api/webhooks/github",
    "https://[2001:db8::1]/api/webhooks/github",
    "http://dashboard.example.com/api/webhooks/github",
  ])("skips a non-public webhook target without calling GitHub: %s", async (hookUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureWebhook({
        token: "secret-token",
        owner: "acme",
        repo: "widgets",
        hookUrl,
      }),
    ).resolves.toEqual({
      ok: false,
      skipped: true,
      error: "public_url_required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a public HTTPS target", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 42 }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureWebhook({
        token: "secret-token",
        owner: "acme",
        repo: "widgets",
        hookUrl: "https://dashboard.example.com/api/webhooks/github",
      }),
    ).resolves.toEqual({ ok: true, hookId: 42, created: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the GitHub status and a sanitized message when a patch fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 42,
              config: {
                url: "https://old.example.com/api/webhooks/github",
              },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message:
              "Resource not accessible by personal access token\nsecret-token",
            sensitive: "must-not-be-returned",
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureWebhook({
      token: "secret-token",
      owner: "acme",
      repo: "widgets",
      hookUrl: "https://dashboard.example.com/api/webhooks/github",
    });

    expect(result).toEqual({
      ok: false,
      error: "patch hook failed",
      status: 403,
      hookId: 42,
      detail:
        "Resource not accessible by personal access token [redacted]",
    });
    expect(JSON.stringify(result)).not.toContain("must-not-be-returned");
  });
});
