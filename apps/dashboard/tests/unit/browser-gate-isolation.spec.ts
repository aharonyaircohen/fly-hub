import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({ config: vi.fn() }));

afterEach(() => vi.unstubAllEnvs());

async function configuration(
  local: string,
  production: string,
  baseUrl: string | undefined,
) {
  vi.resetModules();
  vi.stubEnv("PW_LOCAL", local);
  vi.stubEnv("PW_PRODUCTION", production);
  vi.stubEnv("BASE_URL", baseUrl);
  return (await import("../../playwright.config")).default;
}

describe("browser gate isolation", () => {
  it("preserves CI policy and the explicit default target", async () => {
    vi.stubEnv("CI", "1");
    vi.stubEnv("KODY_BOT_TOKEN", "fixture-not-a-real-token");
    const config = await configuration("", "", undefined);
    expect(config.webServer).toBeUndefined();
    expect(config.use?.baseURL).toBe("http://127.0.0.1:3333");
    expect(config).toMatchObject({
      forbidOnly: true,
      retries: 1,
      maxFailures: 1,
      reporter: [["github"], ["html"]],
    });
    expect(config.projects?.[0].use?.extraHTTPHeaders).toEqual({
      Authorization: "Bearer fixture-not-a-real-token",
    });
  });
  it("owns a separate production server and refuses to reuse an occupied port", async () => {
    const config = await configuration("1", "1", "http://127.0.0.1:3333");
    expect(config.webServer).toMatchObject({
      command: "pnpm exec next start --hostname 127.0.0.1 --port 3344",
      url: "http://127.0.0.1:3344",
      reuseExistingServer: false,
    });
    expect(config.use?.baseURL).toBe("http://127.0.0.1:3344");
    expect(process.env.BASE_URL).toBe(config.use?.baseURL);
  });

  it("keeps development checks on the existing development server", async () => {
    const config = await configuration("1", "0", "https://production.example");
    expect(config.webServer).toMatchObject({
      command: "pnpm dev",
      url: "http://127.0.0.1:3333",
      reuseExistingServer: true,
    });
    expect(config.use?.baseURL).toBe("http://127.0.0.1:3333");
    expect(process.env.BASE_URL).toBe(config.use?.baseURL);
  });

  it("does not start a local server or override a deployed candidate", async () => {
    const config = await configuration("0", "1", "https://candidate.example");
    expect(config.webServer).toBeUndefined();
    expect(config.use?.baseURL).toBe("https://candidate.example");
    expect(process.env.BASE_URL).toBe("https://candidate.example");
  });
  it("builds before the browser gate and runs one browser worker at a time", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["test:e2e:gate"]).toMatch(
      /^pnpm build && PW_PRODUCTION=1 pnpm test:e2e:gate:shard$/,
    );
    expect(packageJson.scripts["test:e2e:gate:shard"]).toContain("--workers=1");
    expect(packageJson.scripts["test:e2e:gate:shard"]).toContain(
      "PW_LOCAL=1 playwright test",
    );
    expect(packageJson.scripts["test:e2e:gate:shard"]).toContain(
      "tests/e2e/memory-journey.spec.ts",
    );
  });
});
