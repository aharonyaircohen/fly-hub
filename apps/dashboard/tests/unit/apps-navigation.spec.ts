import { describe, expect, it } from "vitest";
import {
  SIDEBAR_NAV_SECTIONS,
  navLabelForPath,
} from "@dashboard/lib/components/settings-nav";
import { extendSidebarNavSections } from "@dashboard/lib/components/use-sidebar-nav-sections";

describe("Apps navigation", () => {
  it("shows Apps in the connected repository sidebar and labels its routes", () => {
    const sections = extendSidebarNavSections(SIDEBAR_NAV_SECTIONS, {
      customSpaceItems: [],
      repositoryConnected: true,
    });
    const workspace = sections.find((section) => section.title === "Workspace");

    expect(workspace?.items.map((item) => item.href)).toContain("/apps");
    expect(navLabelForPath("/apps")).toBe("Apps");
    expect(navLabelForPath("/apps/storefront")).toBe("Apps");
  });

  it("does not show Apps without a connected repository", () => {
    const sections = extendSidebarNavSections(SIDEBAR_NAV_SECTIONS, {
      customSpaceItems: [],
      repositoryConnected: false,
    });
    expect(
      sections.flatMap((section) => section.items).map((item) => item.href),
    ).not.toContain("/apps");
  });
});
