import { describe, expect, it } from "vitest";

import {
  storeCatalogPathWithViewState,
  type StoreCatalogViewState,
} from "@dashboard/features/admin/components/StoreCatalogManager";

describe("store catalog routing", () => {
  it("preserves non-default filter and search state in item links", () => {
    const state: StoreCatalogViewState = {
      kind: "workflow",
      search: "bug flow",
    };

    expect(
      storeCatalogPathWithViewState("/store-catalog/capability/bug", state),
    ).toBe("/store-catalog/capability/bug?filter=workflow&q=bug+flow");
  });

  it("omits query params for the default Solutions view", () => {
    expect(
      storeCatalogPathWithViewState("/store-catalog/solution/web-release", {
        kind: "solution",
        search: " ",
      }),
    ).toBe("/store-catalog/solution/web-release");
  });

  it("keeps All explicit because Solutions is the default view", () => {
    expect(
      storeCatalogPathWithViewState("/store-catalog", {
        kind: "all",
        search: "",
      }),
    ).toBe("/store-catalog?filter=all");
  });
});
