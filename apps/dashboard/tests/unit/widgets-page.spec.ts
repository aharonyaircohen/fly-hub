/**
 * Source-level regression tests for the widgets management surface.
 *
 * @testFramework vitest
 * @domain unit
 */
import { existsSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("widgets management page", () => {
  it("serves the canonical package page, API, and nav entry", () => {
    const listPage = readFileSync(
      "app/(chat-rail)/views/widgets/page.tsx",
      "utf8",
    );
    expect(listPage).toContain("@kody-ade/kody-chat-dashboard/pages/widgets");
    expect(existsSync("app/(chat-rail)/views/widgets/[slug]/page.tsx")).toBe(
      true,
    );
    const detailPage = readFileSync(
      "app/(chat-rail)/views/widgets/[slug]/page.tsx",
      "utf8",
    );
    expect(detailPage).toContain(
      "@kody-ade/kody-chat-dashboard/pages/widget-detail",
    );

    const adminRoute = readFileSync("app/api/kody/widgets/route.ts", "utf8");
    expect(adminRoute).toContain(
      "@kody-ade/kody-chat-dashboard/routes/kody/widgets",
    );
    expect(existsSync("app/api/kody/widgets/[slug]/route.ts")).toBe(true);

    // Canonical implementation lives in the package, not this host.
    expect(existsSync("src/dashboard/lib/components/WidgetsManager.tsx")).toBe(
      false,
    );

    const nav = readFileSync(
      "src/dashboard/lib/components/settings-nav.ts",
      "utf8",
    );
    expect(nav).toContain('href: "/views/widgets"');
    expect(nav).toContain('label: "Widgets"');
    expect(nav).toContain('navItemForHref("/views/widgets")');
  });
});
