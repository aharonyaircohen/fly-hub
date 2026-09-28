import { describe, expect, it } from "vitest";
import { FileText } from "lucide-react";

import {
  extendSidebarNavSections,
  type SidebarNavExtensions,
} from "@dashboard/lib/components/use-sidebar-nav-sections";
import type {
  SettingsNavItem,
  SettingsNavSection,
} from "@dashboard/lib/components/settings-nav";

const item = (href: string, label: string): SettingsNavItem => ({
  href,
  label,
  icon: FileText,
});

const sections: readonly SettingsNavSection[] = [
  { title: "Workspace", items: [item("/files", "Files")] },
  {
    title: "Knowledge",
    items: [
      item("/docs", "Docs"),
      item("/context", "Context"),
      item("/file-spaces", "Manage Spaces"),
    ],
  },
  { title: "Content", items: [item("/content/entries", "Entries")] },
];

describe("sidebar navigation extensions", () => {
  it("keeps personal Chat features visible without a repository", () => {
    const personalSections: readonly SettingsNavSection[] = [
      { title: "Knowledge", items: [item("/memory", "Memory"), item("/docs", "Docs")] },
      {
        title: "Configure",
        items: [
          item("/models", "Models"),
          item("/commands", "Commands"),
          item("/guided-flows", "Guided Flows"),
          item("/instructions", "Instructions"),
          item("/secrets", "Secrets"),
          item("/views/renderers", "Renderers"),
          item("/views/widgets", "Widgets"),
          item("/workflows", "Workflows"),
        ],
      },
    ];

    const result = extendSidebarNavSections(personalSections, {
      customSpaceItems: [],
      repositoryConnected: false,
    });

    expect(result.flatMap((section) => section.items.map((entry) => entry.href))).toEqual([
      "/models",
      "/commands",
      "/guided-flows",
      "/views/renderers",
      "/views/widgets",
      "/instructions",
      "/secrets",
      "/memory",
    ]);
  });

  it("places custom document spaces immediately after Docs in Knowledge", () => {
    const extensions: SidebarNavExtensions = {
      customSpaceItems: [
        item("/file-spaces/notes", "Notes"),
        item("/file-spaces/handbook", "Handbook"),
      ],
    };

    const result = extendSidebarNavSections(sections, extensions);

    expect(
      result
        .find((section) => section.title === "Knowledge")
        ?.items.map((navItem) => navItem.href),
    ).toEqual([
      "/docs",
      "/file-spaces/notes",
      "/file-spaces/handbook",
      "/context",
      "/file-spaces",
    ]);
    expect(
      result
        .find((section) => section.title === "Workspace")
        ?.items.map((navItem) => navItem.href),
    ).toEqual(["/files"]);
  });

  it("keeps CMS collections inside Entries instead of global navigation", () => {
    const result = extendSidebarNavSections(sections, {
      customSpaceItems: [],
    });

    expect(
      result
        .find((section) => section.title === "Content")
        ?.items.map((navItem) => navItem.href),
    ).toEqual(["/content/entries"]);
  });
});
