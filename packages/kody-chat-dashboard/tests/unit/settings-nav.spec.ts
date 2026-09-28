import { describe, expect, it } from "vitest";

import {
  SIDEBAR_NAV_SECTIONS,
  PRIMARY_NAV_ITEMS,
  PRIMARY_VIEW_TITLE,
  SETTINGS_NAV_SECTIONS,
  navLabelForPath,
  type SettingsNavSection,
} from "../../src/dashboard/lib/feature-catalog";

function exposedHrefs(): string[] {
  return [
    ...PRIMARY_NAV_ITEMS.map((item) => item.href),
    ...SETTINGS_NAV_SECTIONS.flatMap((section) =>
      section.items.map((item) => item.href),
    ),
  ];
}

function sectionHrefs(
  sections: readonly SettingsNavSection[],
  title: string,
): string[] {
  return (
    sections
      .find((section) => section.title === title)
      ?.items.map((item) => item.href) ?? []
  );
}

describe("settings navigation", () => {
  it("exposes reports and inbox without legacy trust or ledger sections", () => {
    const hrefs = exposedHrefs();

    expect(hrefs).toContain("/reports");
    expect(hrefs).toContain("/inbox");
    expect(hrefs).not.toContain("/trust");
    expect(hrefs).not.toContain("/ledgers");

    expect(navLabelForPath("/reports")).toBe("Reports");
    expect(navLabelForPath("/inbox")).toBe("Inbox");
    expect(navLabelForPath("/trust")).toBeNull();
    expect(navLabelForPath("/ledgers")).toBeNull();
  });

  it("exposes Fly config, previews, Brain images, live machines, volumes, and history as separate pages", () => {
    expect(sectionHrefs(SETTINGS_NAV_SECTIONS, "Fly")).toEqual([
      "/fly/config",
      "/fly/previews",
      "/fly/brain-images",
      "/fly/machines",
      "/fly/volumes",
      "/fly/history",
    ]);
    expect(navLabelForPath("/fly/config")).toBe("Config");
    expect(navLabelForPath("/fly/previews")).toBe("Previews");
    expect(navLabelForPath("/fly/brain-images")).toBe("Brain Images");
    expect(navLabelForPath("/fly/machines")).toBe("Live machines");
    expect(navLabelForPath("/fly/volumes")).toBe("Volumes");
    expect(navLabelForPath("/fly/history")).toBe("History");
    expect(navLabelForPath("/terminal")).toBeNull();
  });

  it("groups content entries, models, and settings into one side-panel section", () => {
    expect(sectionHrefs(SETTINGS_NAV_SECTIONS, "Content")).toEqual([
      "/connections",
      "/content/entries",
      "/content/models",
      "/content/settings",
    ]);
    expect(navLabelForPath("/content/entries")).toBe("Entries");
    expect(navLabelForPath("/content/models")).toBe("Models");
    expect(navLabelForPath("/content/settings")).toBe("Settings");
  });

  it("keeps Dashboard as the only attention-style home entry", () => {
    expect(navLabelForPath("/")).toBe("Dashboard");
    expect(navLabelForPath("/attention")).toBeNull();
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, PRIMARY_VIEW_TITLE)).toEqual([
      "/tasks",
      "/vibe",
      "/preview",
    ]);
  });

  it("presents Quality in the user-facing build order", () => {
    expect(sectionHrefs(SETTINGS_NAV_SECTIONS, "Quality")).toEqual([
      "/quality/scenarios",
      "/quality/journeys",
      "/quality/actions",
      "/quality/runs",
    ]);
  });

  it("shows only the simple Agency surfaces in product order", () => {
    const hrefs = sectionHrefs(SETTINGS_NAV_SECTIONS, "AI Agency");
    expect(hrefs).toEqual([
      "/agency",
      "/todos",
      "/agency-runs",
      "/agents",
      "/agent-loops",
      "/workflows",
      "/pipelines",
      "/capabilities",
    ]);
    expect(navLabelForPath("/operations")).toBeNull();
    expect(navLabelForPath("/company-intents")).toBeNull();
  });

  it("keeps Views active for selected saved preview routes", () => {
    const previewHref = "/preview";
    const previewItem = sectionHrefs(SIDEBAR_NAV_SECTIONS, PRIMARY_VIEW_TITLE)
      .map((href) =>
        SIDEBAR_NAV_SECTIONS.flatMap((section) => section.items).find(
          (item) => item.href === href,
        ),
      )
      .find((item) => item?.href === previewHref);

    expect(previewItem?.label).toBe("Views");
    expect(previewItem?.exact).toBeUndefined();
    expect(navLabelForPath("/preview/dev-4ojw")).toBe("Views");
  });

  it("does not expose the redundant settings page", () => {
    expect(exposedHrefs()).not.toContain("/settings");
    expect(navLabelForPath("/settings")).toBeNull();
  });
});
