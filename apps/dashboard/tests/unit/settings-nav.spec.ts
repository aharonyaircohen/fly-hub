import { describe, expect, it } from "vitest";

import {
  SIDEBAR_NAV_SECTIONS,
  PRIMARY_NAV_ITEMS,
  SETTINGS_NAV_SECTIONS,
  activeCollapsibleNavSectionTitle,
  navLabelForPath,
  type SettingsNavSection,
} from "@dashboard/lib/components/settings-nav";

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

  it("keeps findings and learning inside Reports instead of separate navigation", () => {
    expect(sectionHrefs(SETTINGS_NAV_SECTIONS, "AI Agency")).not.toContain(
      "/findings",
    );
    expect(sectionHrefs(SETTINGS_NAV_SECTIONS, "AI Agency")).not.toContain(
      "/learning",
    );
    expect(navLabelForPath("/findings")).toBeNull();
    expect(navLabelForPath("/learning")).toBeNull();
  });

  it("presents Quality in the user-facing build order", () => {
    expect(sectionHrefs(SETTINGS_NAV_SECTIONS, "Quality")).toEqual([
      "/quality/scenarios",
      "/quality/journeys",
      "/quality/actions",
      "/quality/runs",
    ]);
  });

  it("exposes Fly config, previews, Brain images, live machines, and history as separate pages", () => {
    expect(sectionHrefs(SETTINGS_NAV_SECTIONS, "Fly")).toEqual([
      "/fly/config",
      "/brain",
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
      "/snippets",
      "/triggers",
      "/content/settings",
    ]);
    expect(navLabelForPath("/content/entries")).toBe("Entries");
    expect(navLabelForPath("/content/models")).toBe("Models");
    expect(navLabelForPath("/content/settings")).toBe("Settings");
  });

  it("exposes personal and repository chat models as separate destinations", () => {
    const chat = SETTINGS_NAV_SECTIONS.find(
      (section) => section.title === "Agent Settings",
    )?.items;
    expect(chat).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: "/models",
          label: "Personal Chat Models",
          scope: "personal",
        }),
        expect.objectContaining({
          href: "/repository-models",
          label: "Repo Chat Models",
          scope: "repository",
        }),
      ]),
    );
  });

  it("exposes repository-scoped agent connections", () => {
    expect(sectionHrefs(SETTINGS_NAV_SECTIONS, "Infrastructure")).toContain(
      "/mcp",
    );
    expect(navLabelForPath("/mcp")).toBe("Agent connections");
  });

  it("keeps Dashboard as the only attention-style home entry", () => {
    expect(navLabelForPath("/")).toBe("Dashboard");
    expect(navLabelForPath("/attention")).toBeNull();
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, "Work")).toEqual([
      "/tasks",
      "/vibe",
      "/preview",
      "/inbox",
    ]);
  });

  it("keeps Views active for selected saved preview routes", () => {
    const previewHref = "/preview";
    const previewItem = sectionHrefs(SIDEBAR_NAV_SECTIONS, "Work")
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

  it("shows only the simple Agency surfaces in product order", () => {
    const agency = sectionHrefs(SIDEBAR_NAV_SECTIONS, "Agency");
    expect(agency).toEqual([
      "/agency",
      "/todos",
      "/agency-runs",
      "/agents",
      "/agent-loops",
      "/workflows",
      "/pipelines",
      "/capabilities",
    ]);
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, "Store")).toEqual([
      "/store-catalog",
      "/company",
    ]);
    expect(navLabelForPath("/agency-runs")).toBe("Runs");
    expect(navLabelForPath("/agency")).toBe("Intents");
  });

  it("orders the desktop rail around work and collapsible ownership groups", () => {
    expect(SIDEBAR_NAV_SECTIONS.map((section) => section.title)).toEqual([
      "Work",
      "Agency",
      "Store",
      "Quality",
      "Workspace",
      "Knowledge",
      "Content",
      "Chat",
      "Client",
      "Fly",
      "System",
    ]);
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, "Work")).toEqual([
      "/tasks",
      "/vibe",
      "/preview",
      "/inbox",
    ]);
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, "Agency")).toEqual([
      "/agency",
      "/todos",
      "/agency-runs",
      "/agents",
      "/agent-loops",
      "/workflows",
      "/pipelines",
      "/capabilities",
    ]);
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, "Store")).toEqual([
      "/store-catalog",
      "/company",
    ]);
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, "Workspace")).toEqual([
      "/org",
      "/apps",
      "/messages",
      "/reports",
      "/files",
      "/changelog",
    ]);
    expect(navLabelForPath("/apps")).toBe("Apps");
    expect(navLabelForPath("/apps/storefront")).toBe("Apps");
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, "Knowledge")).toEqual([
      "/docs",
      "/context",
      "/policies",
      "/constraints",
      "/memory",
      "/file-spaces",
    ]);
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, "Chat")).not.toEqual(
      expect.arrayContaining([
        "/context",
        "/memory",
        "/policies",
        "/constraints",
      ]),
    );
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, "Fly")).toEqual([
      "/fly/config",
      "/brain",
      "/fly/previews",
      "/fly/brain-images",
      "/fly/machines",
      "/fly/volumes",
      "/fly/history",
    ]);
    expect(
      sectionHrefs(SIDEBAR_NAV_SECTIONS, "System").some((href) =>
        href.startsWith("/fly/"),
      ),
    ).toBe(false);
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, "System")).not.toContain(
      "/brain",
    );
    expect(SIDEBAR_NAV_SECTIONS.every((section) => section.collapsible)).toBe(
      true,
    );
    expect(SIDEBAR_NAV_SECTIONS.every((section) => section.icon)).toBe(true);
    expect(SIDEBAR_NAV_SECTIONS.every((section) => section.tint)).toBe(true);
  });

  it("opens only the active collapsible parent for a nested route", () => {
    expect(
      activeCollapsibleNavSectionTitle(
        SIDEBAR_NAV_SECTIONS,
        "/capabilities/example",
        "",
      ),
    ).toBe("Agency");
    expect(
      activeCollapsibleNavSectionTitle(SIDEBAR_NAV_SECTIONS, "/memory", ""),
    ).toBe("Knowledge");
    expect(
      activeCollapsibleNavSectionTitle(
        SIDEBAR_NAV_SECTIONS,
        "/file-spaces",
        "",
      ),
    ).toBe("Knowledge");
    expect(
      activeCollapsibleNavSectionTitle(SIDEBAR_NAV_SECTIONS, "/tasks", ""),
    ).toBe("Work");
    expect(
      activeCollapsibleNavSectionTitle(
        SIDEBAR_NAV_SECTIONS,
        "/fly/machines",
        "",
      ),
    ).toBe("Fly");
  });

  it("does not expose the redundant settings page", () => {
    expect(sectionHrefs(SIDEBAR_NAV_SECTIONS, "System")).not.toContain(
      "/settings",
    );
    expect(exposedHrefs()).not.toContain("/settings");
    expect(navLabelForPath("/settings")).toBeNull();
  });

  it("does not expose a standalone capability contracts page", () => {
    expect(exposedHrefs()).not.toContain("/capability-contracts");
    expect(navLabelForPath("/capability-contracts")).toBeNull();
  });
});
