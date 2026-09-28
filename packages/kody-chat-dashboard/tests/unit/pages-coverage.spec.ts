/**
 * @fileoverview Every canonical shared page (src/dashboard/lib/pages/*) must
 * be served by this app via a route file that re-exports it. Adding a page
 * without registering its route fails here with the missing path.
 * @testFramework vitest
 * @domain pages
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGES_DIR = join(process.cwd(), "src/dashboard/lib/pages");

describe("shared pages route coverage", () => {
  const pages = readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\.tsx$/, ""));

  it("exports every canonical page for a host to mount", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { exports: Record<string, string> };

    expect(packageJson.exports["./pages/*"]).toBe(
      "./src/dashboard/lib/pages/*.tsx",
    );
    for (const page of pages) {
      const target = `./src/dashboard/lib/pages/${page}.tsx`;
      expect(existsSync(join(process.cwd(), target))).toBe(true);
    }
  });
});
