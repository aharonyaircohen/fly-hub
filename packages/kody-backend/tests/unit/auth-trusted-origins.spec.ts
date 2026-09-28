import { describe, expect, it } from "vitest";

import {
  authSiteUrl,
  authTrustedOrigins,
} from "../../convex/betterAuth/trustedOrigins";

describe("authTrustedOrigins", () => {
  it("accepts the primary site and additional dashboard aliases", () => {
    expect(
      authTrustedOrigins({
        SITE_URL: "https://dashboard.example.com",
        KODY_AUTH_TRUSTED_ORIGINS:
          " https://dashboard-alias.example.com,https://preview.example.com ",
      }),
    ).toEqual([
      "https://dashboard.example.com",
      "https://dashboard-alias.example.com",
      "https://preview.example.com",
    ]);
  });
});

describe("authSiteUrl", () => {
  it("uses the dashboard URL for proxied Next.js auth callbacks", () => {
    expect(
      authSiteUrl({
        SITE_URL: " https://dashboard.example.com ",
        CONVEX_SITE_URL: "https://backend.convex.site",
      }),
    ).toBe("https://dashboard.example.com");
  });
});
