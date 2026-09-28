/**
 * Source-level regression tests for the view renderers management surface.
 *
 * @testFramework vitest
 * @domain unit
 */
import { existsSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("view renderers management page", () => {
  it("serves the canonical package pages, API, and nav entry", () => {
    const listPage = readFileSync(
      "app/(chat-rail)/views/renderers/page.tsx",
      "utf8",
    );
    expect(listPage).toContain("@kody-ade/kody-chat-dashboard/pages/view-renderers");

    const detailPage = readFileSync(
      "app/(chat-rail)/views/renderers/[slug]/page.tsx",
      "utf8",
    );
    expect(detailPage).toContain(
      "@kody-ade/kody-chat-dashboard/pages/view-renderer-detail",
    );

    expect(existsSync("app/api/kody/view-renderers/route.ts")).toBe(true);
    expect(existsSync("app/api/kody/view-renderers/[slug]/route.ts")).toBe(
      true,
    );

    // Canonical implementation lives in the package, not this host.
    expect(
      existsSync("src/dashboard/lib/components/ViewRenderersManager.tsx"),
    ).toBe(false);

    const nav = readFileSync(
      "src/dashboard/lib/components/settings-nav.ts",
      "utf8",
    );
    expect(nav).toContain('href: "/views/renderers"');
    expect(nav).toContain('label: "View Renderers"');
  });
});
