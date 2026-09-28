import { describe, expect, it } from "vitest";

import { PACKAGE_ADMIN_PAGE_META } from "../src/admin-pages-meta";

describe("package admin page metadata", () => {
  it("places Themes directly after Brands and before Languages", () => {
    expect(PACKAGE_ADMIN_PAGE_META.map(({ href }) => href)).toEqual([
      "/themes",
      "/languages",
    ]);
  });
});
