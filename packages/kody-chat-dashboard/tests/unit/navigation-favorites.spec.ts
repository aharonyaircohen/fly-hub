import { describe, expect, it } from "vitest";
import {
  MAX_NAVIGATION_FAVORITES,
  normalizeFavoriteHrefs,
  resolveFavoriteItems,
  toggleFavoriteHref,
} from "../../src/dashboard/lib/navigation-favorites";

const items = [
  { href: "/tasks", label: "Tasks" },
  { href: "/reports", label: "Reports" },
  { href: "/preview", label: "Preview" },
];

describe("navigation favorites", () => {
  it("normalizes unknown, duplicate, and malformed stored hrefs", () => {
    expect(
      normalizeFavoriteHrefs(
        ["/reports", "/unknown", "/reports", 42, "/tasks"],
        items,
      ),
    ).toEqual(["/reports", "/tasks"]);
  });

  it("resolves favorites in the user's saved order", () => {
    expect(resolveFavoriteItems(["/reports", "/tasks"], items)).toEqual([
      items[1],
      items[0],
    ]);
  });

  it("adds and removes a favorite without mutating the current list", () => {
    const current = ["/tasks"];

    expect(toggleFavoriteHref(current, "/reports")).toEqual([
      "/tasks",
      "/reports",
    ]);
    expect(toggleFavoriteHref(current, "/tasks")).toEqual([]);
    expect(current).toEqual(["/tasks"]);
  });

  it("rejects a ninth favorite without changing the list", () => {
    const current = Array.from(
      { length: MAX_NAVIGATION_FAVORITES },
      (_, index) => `/item-${index}`,
    );

    expect(toggleFavoriteHref(current, "/another")).toBe(current);
  });
});
