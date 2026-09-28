import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");
const integrationRoot = resolve(
  repositoryRoot,
  "packages/kody-chat-dashboard",
);

describe("private chat integration package shape", () => {
  it("is a library integration rather than a second Next application", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(integrationRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.build).toBe("tsc --noEmit");
    expect(packageJson.scripts).not.toHaveProperty("dev");
    expect(packageJson.scripts).not.toHaveProperty("start");
    expect(packageJson.scripts).not.toHaveProperty("test:e2e:local");
    expect(packageJson.scripts).not.toHaveProperty("test:gate");
  });

  it.each([
    "app/(shell)",
    "app/KodyProviders.tsx",
    "app/layout.tsx",
    "app/metadata.ts",
    "instrumentation.ts",
    "next.config.mjs",
    "playwright.config.ts",
    "postcss.config.js",
    "tailwind.config.mjs",
    "tailwind.tokens.mjs",
    "public",
    "tests/e2e",
  ])("does not contain harness-only path %s", (relativePath) => {
    expect(existsSync(resolve(integrationRoot, relativePath))).toBe(false);
  });
});
