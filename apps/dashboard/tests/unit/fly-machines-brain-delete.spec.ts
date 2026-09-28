/**
 * @fileoverview Guard the boundary between Fly infrastructure and managed apps.
 * @testFramework vitest
 * @domain fly
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/dashboard/features/previews/components/FlyMachinesTable.tsx",
  ),
  "utf8",
);

describe("Live Machines application boundary", () => {
  it("uses only generic Fly inventory and lifecycle APIs", () => {
    expect(SOURCE).toContain('fetch("/api/kody/fly/machines"');
    expect(SOURCE).toContain('fetch("/api/kody/fly/machines/action"');
    expect(SOURCE).not.toContain("/api/kody/brain/");
  });
});
