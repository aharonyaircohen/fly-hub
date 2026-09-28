import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("todo item route surfaces", () => {
  it("has an app route for selected todo items", () => {
    const path = "app/(chat-rail)/todos/[slug]/[itemId]/page.tsx";
    expect(existsSync(join(process.cwd(), path))).toBe(true);

    const source = read(path);
    expect(source).toContain("selectedSlug");
    expect(source).toContain("selectedItemId");
  });

  it("keeps todo list and todo item navigation repo-scoped", () => {
    const source = read("src/dashboard/features/tasks/components/TodoControl.tsx");

    expect(source).toContain("selectedItemId");
    expect(source).toContain("useRepoScopedHref");
    expect(source).toContain('selectionPath("/todos", list.slug, item.id)');
    expect(source).toContain("isSelected={selectedItemId === item.id}");
  });
});
