import { afterEach, describe, expect, it, vi } from "vitest";
import { registerActiveWebhook } from "../../src/dashboard/lib/webhooks/reconciliation-client";

describe("webhook reconciliation client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves GitHub status details needed for an actionable notice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "list hooks failed",
            status: 404,
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(
      registerActiveWebhook({
        token: "github_pat_test",
        owner: "acme",
        repo: "service",
        repoUrl: "https://github.com/acme/service",
        index: 0,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: "list hooks failed",
      status: 404,
    });
  });

  it("preserves an intentional skip so the UI stays quiet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "preview_environment",
            skipped: true,
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(
      registerActiveWebhook({
        token: "github_pat_test",
        owner: "acme",
        repo: "service",
        repoUrl: "https://github.com/acme/service",
        index: 0,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: "preview_environment",
      skipped: true,
    });
  });
});
