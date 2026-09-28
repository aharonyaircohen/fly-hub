import { describe, expect, it, vi } from "vitest";
import { verifyInstagramConnection } from "@dashboard/lib/connections/instagram-verification";

describe("Instagram Connection verification", () => {
  it.each(["CREATOR", "BUSINESS"])("accepts a matching %s account", async (accountType) => {
    const fetcher = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) =>
        String(input).includes("content_publishing_limit")
          ? Response.json({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] })
          : Response.json({
              id: "17841400000000000",
              username: "kody_creator",
              account_type: accountType,
            }),
    );
    await expect(verifyInstagramConnection({
      externalId: "17841400000000000",
      accessToken: "secret-value",
    }, fetcher)).resolves.toEqual({ ok: true, externalName: "@kody_creator" });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain("graph.instagram.com/");
    expect(String(url)).not.toContain("secret-value");
    expect(init?.headers).toEqual({ Authorization: "Bearer secret-value" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not connect when the token cannot access publishing", async () => {
    let request = 0;
    await expect(verifyInstagramConnection({ externalId: "1", accessToken: "token" }, async () => {
      request += 1;
      return request === 1
        ? Response.json({ id: "1", username: "creator", account_type: "CREATOR" })
        : Response.json({ error: {} }, { status: 403 });
    })).resolves.toEqual({ ok: false, reason: "publishing_unavailable" });
  });

  it("rejects personal, mismatched, and provider-rejected accounts", async () => {
    await expect(verifyInstagramConnection({ externalId: "1", accessToken: "token" }, async () =>
      Response.json({ id: "1", username: "personal", account_type: "PERSONAL" }),
    )).resolves.toEqual({ ok: false, reason: "unsupported_account_type" });
    await expect(verifyInstagramConnection({ externalId: "1", accessToken: "token" }, async () =>
      Response.json({ id: "2", username: "creator", account_type: "CREATOR" }),
    )).resolves.toEqual({ ok: false, reason: "account_mismatch" });
    await expect(verifyInstagramConnection({ externalId: "1", accessToken: "token" }, async () =>
      Response.json({ error: {} }, { status: 401 }),
    )).resolves.toEqual({ ok: false, reason: "provider_rejected" });
  });
});
