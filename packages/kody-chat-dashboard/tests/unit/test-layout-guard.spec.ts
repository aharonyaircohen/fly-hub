import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("test layout guard", () => {
  it("keeps tests/ free of layer-less specs (specs must live in unit/, int/, or e2e/)", () => {
    const testsDir = resolve(process.cwd(), "tests");
    const straySpecs = readdirSync(testsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
      .map((entry) => entry.name);

    expect(
      straySpecs,
      `Spec files must live under tests/unit, tests/int, or tests/e2e — move: ${straySpecs.join(", ")}`,
    ).toEqual([]);
  });
});
