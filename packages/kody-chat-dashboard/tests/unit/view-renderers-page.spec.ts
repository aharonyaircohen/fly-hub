/**
 * Source-level regression tests for the view renderers management surface.
 *
 * @testFramework vitest
 * @domain unit
 */
import { existsSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("view renderers management page", () => {
  it("exports the integration pages, API, and navigation entry", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, string>;
    };
    expect(packageJson.exports["./pages/*"]).toBe(
      "./src/dashboard/lib/pages/*.tsx",
    );
    expect(
      existsSync("src/dashboard/lib/pages/view-renderers.tsx"),
    ).toBe(true);
    expect(
      existsSync("src/dashboard/lib/pages/view-renderer-detail.tsx"),
    ).toBe(true);
    expect(existsSync("app/api/kody/view-renderers/route.ts")).toBe(true);
    expect(existsSync("app/api/kody/view-renderers/[slug]/route.ts")).toBe(
      true,
    );
    expect(
      existsSync("src/dashboard/lib/components/ViewRenderersManager.tsx"),
    ).toBe(true);

    const nav = readFileSync(
    "src/dashboard/lib/feature-catalog.ts",
      "utf8",
    );
    expect(nav).toContain('href: "/views/renderers"');
    expect(nav).toContain('label: "View Renderers"');

    const manager = readFileSync(
      "src/dashboard/lib/components/ViewRenderersManager.tsx",
      "utf8",
    );
    expect(manager).toContain("<MasterDetailShell");
    expect(manager).toContain("function RendererPreviewDetail");
    expect(manager).toContain("function buildRendererPreviewData");
    expect(manager).toContain("Renderer JSON");
    expect(manager).toContain("purpose:");
    expect(manager).toContain("rule:");
    expect(manager).toContain("defaults:");
    expect(manager).toContain(">Rule<");
    expect(manager).toContain(">Defaults<");
    expect(manager).toContain("Example title");
    expect(manager).toContain("Example supporting text.");
    expect(manager).toContain("No actions configured.");
    expect(manager).toContain(
      "router.push(`/views/renderers/${encodeURIComponent(renderer.slug)}`)",
    );
    expect(manager).toContain("New renderer");
    expect(manager).toContain("Edit renderer");
    expect(manager).toContain(">Preview<");
    expect(manager).toContain("<Dialog open={open}");
    expect(manager).not.toContain("function RendererItem");
  });
});
