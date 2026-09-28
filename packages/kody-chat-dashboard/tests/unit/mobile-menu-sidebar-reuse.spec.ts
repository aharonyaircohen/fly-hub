import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const components = resolve(__dirname, "../../src/dashboard/lib/components");
const mobileMenuSource = readFileSync(
  resolve(components, "MobileMenu.tsx"),
  "utf8",
);
const sidebarSource = readFileSync(resolve(components, "Sidebar.tsx"), "utf8");

describe("mobile menu sidebar reuse", () => {
  it("renders the shared sidebar inside the mobile sheet", () => {
    expect(mobileMenuSource).toContain('import { Sidebar } from "./Sidebar"');
    expect(mobileMenuSource).toMatch(
      /<Sidebar\s+presentation="mobile"/,
    );
    expect(mobileMenuSource).toContain("onNavigate={close}");
    expect(mobileMenuSource).toContain("headerExtra={headerExtra}");
    expect(mobileMenuSource).toContain("navigationExtra={workspacePrimary}");
    expect(mobileMenuSource).toContain("extras={extras}");
    expect(mobileMenuSource).toContain("bottomCta={bottomCta}");
  });

  it("removes the old duplicate mobile navigation renderer", () => {
    expect(mobileMenuSource).not.toContain("MOBILE_NAV_SECTIONS");
    expect(mobileMenuSource).not.toContain("settingsSections.map");
    expect(mobileMenuSource).not.toContain("workspaceItems.map");
    expect(mobileMenuSource).not.toContain("viewItems.map");
    expect(mobileMenuSource).not.toContain("AddRepoForm");
    expect(mobileMenuSource).toContain(
      'headerExtra = <RepoSwitcher variant="rail" />',
    );
  });

  it("lets the shared sidebar adapt its shell and close after navigation", () => {
    expect(sidebarSource).toContain('presentation?: "desktop" | "mobile";');
    expect(sidebarSource).toContain("onNavigate?: () => void;");
    expect(sidebarSource).toContain('const mobile = presentation === "mobile";');
    expect(sidebarSource).toContain("onClick={onNavigate}");
    expect(sidebarSource).toContain("{!mobile && (");
  });
});
