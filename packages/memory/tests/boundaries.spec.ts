import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("memory package boundaries", () => {
  it("builds its exported files during a clean workspace install", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.prepare).toBe("pnpm build");
  });

  it("has no runtime dependencies", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(pkg.dependencies).toBeUndefined();
  });

  it("does not depend on infrastructure or legacy file models", () => {
    const sourceDirectory = resolve(import.meta.dirname, "../src");
    const source = readdirSync(sourceDirectory)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(resolve(sourceDirectory, file), "utf8"))
      .join("\n");

    expect(source).not.toMatch(
      /from ["'](?:convex|next|react|ai|@octokit|@kody-ade\/backend|@kody-ade\/workspace)/,
    );
    expect(source).not.toMatch(
      /\b(?:MemoryFile|MemoryFrontmatter|Octokit|repoDocs|htmlUrl|sha)\b/,
    );
  });
});
