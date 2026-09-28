import { beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({ facebook: vi.fn(), instagram: vi.fn() }));
vi.mock("@dashboard/lib/connections/facebook-verification", () => ({
  verifyFacebookPageConnection: providers.facebook,
}));
vi.mock("@dashboard/lib/connections/instagram-verification", () => ({
  verifyInstagramConnection: providers.instagram,
}));

import { verifyConnection } from "@dashboard/lib/connections/verification";

const base = {
  id: "instagram-main",
  name: "Creator",
  provider: "instagram",
  accountType: "professional",
  externalId: "17841400000000000",
  credentialRefs: { accessToken: "INSTAGRAM_ACCESS_TOKEN" },
  status: "needs_attention" as const,
  verifiedAt: null,
};

beforeEach(() => vi.clearAllMocks());

describe("Connection provider verification", () => {
  it("routes Instagram through its adapter", async () => {
    providers.instagram.mockResolvedValue({ ok: true, externalName: "@creator" });
    await expect(verifyConnection(base, "secret-value")).resolves.toEqual({ ok: true, externalName: "@creator" });
    expect(providers.instagram).toHaveBeenCalledWith({ externalId: base.externalId, accessToken: "secret-value" });
    expect(providers.facebook).not.toHaveBeenCalled();
  });

  it("fails closed for unknown provider and account-type combinations", async () => {
    await expect(verifyConnection({ ...base, accountType: "personal" }, "secret-value")).resolves.toEqual({
      ok: false,
      reason: "unsupported_connection",
    });
    expect(providers.instagram).not.toHaveBeenCalled();
  });
});
