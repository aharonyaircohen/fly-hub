import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(
  resolve(
    process.cwd(),
    "src/dashboard/lib/components/Sidebar.tsx",
  ),
  "utf8",
);

describe("sidebar navigation search", () => {
  it("does not accept browser-restored values from unrelated inputs", () => {
    expect(sidebarSource).toContain('type="search"');
    expect(sidebarSource).toContain('name="kody-navigation-search"');
    expect(sidebarSource).toContain('autoComplete="off"');
    expect(sidebarSource).toContain('aria-label="Clear search"');
    expect(sidebarSource).toContain(
      "[&::-webkit-search-cancel-button]:appearance-none",
    );
  });

  it("releases focus after keyboard navigation", () => {
    expect(sidebarSource).toContain("e.currentTarget.blur()");
    expect(sidebarSource.indexOf("e.currentTarget.blur()")).toBeLessThan(
      sidebarSource.indexOf(
        "router.push(scopedHref(firstMatch.href, firstMatch.scope))",
      ),
    );
  });
});
