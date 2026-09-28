/**
 * Source-level regression tests for the widgets management surface.
 *
 * @testFramework vitest
 * @domain unit
 */
import { existsSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("widgets management page", () => {
  it("lets the owner delete the selected widget", () => {
    const manager = readFileSync(
      "src/dashboard/lib/components/WidgetsManager.tsx",
      "utf8",
    );
    expect(manager).toContain("aria-label={`Delete ${widget.name}`}");
    expect(manager).toContain('method: "DELETE"');
  });

  it("exports the integration page, API, and navigation entry", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, string>;
    };
    expect(packageJson.exports["./pages/*"]).toBe(
      "./src/dashboard/lib/pages/*.tsx",
    );
    expect(existsSync("src/dashboard/lib/pages/widgets.tsx")).toBe(true);
    expect(existsSync("src/dashboard/lib/pages/widget-detail.tsx")).toBe(true);
    expect(existsSync("app/api/kody/widgets/route.ts")).toBe(true);
    expect(existsSync("app/api/kody/widgets/[slug]/route.ts")).toBe(true);
    expect(existsSync("src/dashboard/lib/components/WidgetsManager.tsx")).toBe(
      true,
    );

    const exports = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, string>;
    };
    expect(exports.exports["./routes/kody/widgets"]).toBe(
      "./app/api/kody/widgets/route.ts",
    );

    const nav = readFileSync("src/dashboard/lib/feature-catalog.ts", "utf8");
    expect(nav).toContain('href: "/views/widgets"');
    expect(nav).toContain('label: "Widgets"');

    const manager = readFileSync(
      "src/dashboard/lib/components/WidgetsManager.tsx",
      "utf8",
    );
    expect(manager).toContain("<MasterDetailShell");
    expect(manager).toContain("Upload widget");
    expect(manager).toContain("Name");
    expect(manager).toContain("widgetSlugFromName");
    expect(manager).toContain('selectionPath("/views/widgets", widget.slug)');
    expect(manager).toContain("useRepoScopedHref");
    expect(manager).toContain("initialSlug");
    expect(manager).not.toContain("data-page-slug");
    expect(manager).not.toContain("data-modal-slug");
    expect(manager).not.toContain("data-widget-slug");
    expect(manager).not.toContain('htmlFor="widget-upload-slug"');
    expect(manager).toContain("Choose file");
    expect(manager).toContain("Commit SHA (optional)");
    expect(manager).toContain("Play in Chat");
    expect(manager).toContain("requestWidgetOpen");
    expect(manager).not.toContain("widgetChatHref");
    expect(manager).not.toContain("next/link");
    expect(manager).toContain("No widgets yet");
    expect(manager).toContain("precompiled JS bundles published to");
    expect(manager).toContain("<Dialog open={open}");
    expect(manager).toContain("900_000");
  });
});
