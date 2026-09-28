import { describe, expect, it } from "vitest";

import { PACKAGE_ADMIN_PAGES } from "../../src/dashboard/lib/admin-pages";

describe("package admin pages", () => {
  it("mounts Themes and Languages with their own panels", () => {
    expect(
      PACKAGE_ADMIN_PAGES.map(({ href, panelId, plugin }) => ({
        href,
        panelId,
        pluginId: plugin.id,
      })),
    ).toEqual([
      { href: "/themes", panelId: "themes", pluginId: "themes" },
      {
        href: "/languages",
        panelId: "languages",
        pluginId: "languages",
      },
    ]);
  });
});
