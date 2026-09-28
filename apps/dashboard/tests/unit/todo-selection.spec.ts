import { describe, expect, it } from "vitest";

import {
  todoItemSelectionRedirect,
  todoListSelectionRedirect,
} from "@dashboard/lib/todos/selection";

describe("todo list selection routing", () => {
  it("does not auto-select the first list when no list is selected", () => {
    expect(todoListSelectionRedirect(null, ["first", "second"])).toBeNull();
  });

  it("keeps valid selected todo list routes in place", () => {
    expect(todoListSelectionRedirect("second", ["first", "second"])).toBeNull();
  });

  it("clears a selected todo list route that no longer exists", () => {
    expect(todoListSelectionRedirect("missing", ["first", "second"])).toBe(
      "/todos",
    );
  });

  it("keeps valid selected todo item routes in place", () => {
    expect(
      todoItemSelectionRedirect("item-2", ["item-1", "item-2"], "/todos/list"),
    ).toBeNull();
  });

  it("clears a selected todo item route that no longer exists", () => {
    expect(
      todoItemSelectionRedirect("missing", ["item-1", "item-2"], "/todos/list"),
    ).toBe("/todos/list");
  });
});
