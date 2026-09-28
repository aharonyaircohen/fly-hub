/**
 * Unit tests for the generic array-move helper behind SortableList
 * (src/ui/sortable-list.tsx).
 */
import { describe, it, expect } from "vitest";
import { moveArrayItem } from "../src/ui/sortable-list";

describe("moveArrayItem", () => {
  it("moves an item forward", () => {
    expect(moveArrayItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });
  it("moves an item backward", () => {
    expect(moveArrayItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("returns the same reference when nothing moves", () => {
    const items = ["a", "b", "c"];
    expect(moveArrayItem(items, 1, 1)).toBe(items);
    expect(moveArrayItem(items, -1, 0)).toBe(items);
    expect(moveArrayItem(items, 5, 0)).toBe(items);
  });
});
