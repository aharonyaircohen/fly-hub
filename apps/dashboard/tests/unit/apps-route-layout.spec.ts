import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Apps route ownership", () => {
  it("keeps the Apps workspace mounted while the selected slug changes", () => {
    const layout = read("app/apps/layout.tsx");
    const rootPage = read("app/apps/page.tsx");
    const selectedPage = read("app/apps/[slug]/page.tsx");

    expect(layout).toContain("<AppsPage />");
    expect(rootPage).not.toContain("AppsPage");
    expect(selectedPage).not.toContain("AppsPage");
  });
});
