import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("convex/crons.ts"), "utf8");

describe("Loop wake cron", () => {
  it("checks often enough to cover preferred-time Loop windows", () => {
    expect(source).toContain('{ minutes: 1 }');
    expect(source).toContain("internal.loopWakes.dispatchDue");
  });
});
