import { describe, expect, it, vi } from "vitest";
import { verifyFacebookPageConnection } from "@dashboard/lib/connections/facebook-verification";

describe("Facebook Connection verification", () => {
  it("uses bearer authentication and verifies the exact Page id", async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({ id: "123456789", name: "Yair Facebook Page" }),
    );
    await expect(
      verifyFacebookPageConnection(
        { externalId: "123456789", accessToken: "secret-value" },
        fetcher,
      ),
    ).resolves.toEqual({ ok: true, externalName: "Yair Facebook Page" });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).not.toContain("secret-value");
    expect(init?.headers).toEqual({ Authorization: "Bearer secret-value" });
  });

  it("fails closed on mismatch or provider failure", async () => {
    await expect(
      verifyFacebookPageConnection(
        { externalId: "123456789", accessToken: "secret-value" },
        async () => Response.json({ id: "987654321", name: "Wrong" }),
      ),
    ).resolves.toEqual({ ok: false, reason: "page_mismatch" });
    await expect(
      verifyFacebookPageConnection(
        { externalId: "123456789", accessToken: "secret-value" },
        async () => Response.json({ error: {} }, { status: 401 }),
      ),
    ).resolves.toEqual({ ok: false, reason: "provider_rejected" });
  });
});
