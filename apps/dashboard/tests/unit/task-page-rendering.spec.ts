import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const taskPageSource = readFileSync(
  join(process.cwd(), "app/[issueNumber]/page.tsx"),
  "utf8",
);

describe("task page rendering", () => {
  it("renders numeric task routes at request time", () => {
    expect(taskPageSource).toContain('export const dynamic = "force-dynamic"');
  });
});
