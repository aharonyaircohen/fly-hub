import { describe, expect, it } from "vitest";

import {
  PREVIEW_NAV_ITEM,
  PRIMARY_NAV_ITEMS,
  SETTINGS_NAV_SECTIONS,
  TASKS_NAV_ITEM,
  isNavItemActive,
  navLabelForPath,
  type SettingsNavItem,
} from "@dashboard/lib/components/settings-nav";

const itemByHref = (href: string): SettingsNavItem => {
  const item = [
    ...PRIMARY_NAV_ITEMS,
    ...SETTINGS_NAV_SECTIONS.flatMap((section) => section.items),
  ].find((candidate) => candidate.href === href);
  if (!item) throw new Error(`Missing nav item ${href}`);
  return item;
};

describe("sidebar active route matching", () => {
  it("keeps detail pages selected under their side panel item", () => {
    expect(
      isNavItemActive("/agency", "", itemByHref("/agency")),
    ).toBe(true);
    expect(
      isNavItemActive("/agent-loops/loop-1", "", itemByHref("/agent-loops")),
    ).toBe(true);
    expect(
      isNavItemActive("/workflows/workflow-1", "", itemByHref("/workflows")),
    ).toBe(true);
    expect(
      isNavItemActive(
        "/capabilities/build-preview",
        "",
        itemByHref("/capabilities"),
      ),
    ).toBe(true);
    expect(
      isNavItemActive(
        "/store-catalog/capability/build-preview",
        "",
        itemByHref("/store-catalog"),
      ),
    ).toBe(true);
  });

  it("keeps task detail pages selected under Tasks", () => {
    expect(isNavItemActive("/123", "", TASKS_NAV_ITEM)).toBe(true);
    expect(isNavItemActive("/123/comments", "", TASKS_NAV_ITEM)).toBe(true);
    expect(isNavItemActive("/123/preview/docs", "", TASKS_NAV_ITEM)).toBe(true);
  });

  it("keeps repo-scoped pages selected under their shared nav item", () => {
    expect(
      isNavItemActive(
        "/repo/A-Guy-educ/A-Guy-Web/123/preview/docs",
        "",
        TASKS_NAV_ITEM,
      ),
    ).toBe(true);
    expect(
      isNavItemActive(
        "/repo/A-Guy-educ/A-Guy-Web/reports/release-health",
        "",
        itemByHref("/reports"),
      ),
    ).toBe(true);
    expect(navLabelForPath("/repo/A-Guy-educ/A-Guy-Web/files/src/app.ts")).toBe(
      "Files",
    );
  });

  it("does not lose selected state when an exact page has query params", () => {
    expect(
      isNavItemActive("/agency", "view=mine", itemByHref("/agency")),
    ).toBe(true);
  });

  it("keeps Views selected for dynamic preview pages", () => {
    expect(isNavItemActive("/preview/dev-4ojw", "", PREVIEW_NAV_ITEM)).toBe(
      true,
    );
    expect(navLabelForPath("/preview/dev-4ojw")).toBe("Views");
  });

  it("resolves labels for side panel detail routes", () => {
    expect(navLabelForPath("/123/preview/docs")).toBe("Tasks");
    expect(navLabelForPath("/agency")).toBe("Intents");
    expect(navLabelForPath("/store-catalog/capability/build-preview")).toBe(
      "Store Catalog",
    );
    expect(navLabelForPath("/store-catalog/solution/web-release")).toBe(
      "Store Catalog",
    );
  });
});
