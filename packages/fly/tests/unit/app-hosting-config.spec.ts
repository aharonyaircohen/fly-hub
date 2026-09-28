import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppHostingConfig } from "../../src/apps/hosting-config";

describe("resolveAppHostingConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses Kody's server-owned Apps credential", () => {
    vi.stubEnv("KODY_APPS_FLY_API_TOKEN", "platform-token");
    vi.stubEnv("KODY_APPS_FLY_ORG_SLUG", "kody-hosting");
    vi.stubEnv("KODY_APPS_FLY_DEFAULT_REGION", "ams");

    expect(resolveAppHostingConfig()).toEqual({
      token: "platform-token",
      orgSlug: "kody-hosting",
      defaultRegion: "ams",
    });
  });

  it("does not require a repository vault", () => {
    vi.stubEnv("KODY_APPS_FLY_API_TOKEN", "");
    vi.stubEnv("FLY_API_TOKEN", "local-platform-token");

    expect(resolveAppHostingConfig()?.token).toBe("local-platform-token");
  });
});
