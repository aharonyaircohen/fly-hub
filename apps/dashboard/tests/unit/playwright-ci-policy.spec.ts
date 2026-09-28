import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Playwright CI policy", () => {
  it("stops after the first real browser failure", async () => {
    const source = await readFile(
      new URL("../../playwright.config.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("maxFailures: process.env.CI ? 1 : undefined");
  });
});
