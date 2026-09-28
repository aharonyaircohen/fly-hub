import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/Sidebar.tsx"),
  "utf8",
);

describe("sidebar mode toggle removal", () => {
  it("uses one navigation model without a Vibe or Engineer mode", () => {
    expect(sidebarSource).toContain("const baseSections = hostSections;");
    expect(sidebarSource).not.toContain("SIDEBAR_NAV_SECTIONS");
    expect(sidebarSource).not.toContain("SidebarMode");
    expect(sidebarSource).not.toContain("sidebarMode");
    expect(sidebarSource).not.toContain("MODE_KEY");
    expect(sidebarSource).not.toContain("VIBE_MODE_SECTIONS");
    expect(sidebarSource).not.toContain("ENGINEER_MODE_SECTIONS");
    expect(sidebarSource).not.toContain('aria-label="Sidebar mode"');
    expect(sidebarSource).not.toContain("Switch to Engineer");
    expect(sidebarSource).not.toContain("Switch to Vibe");
  });
});
