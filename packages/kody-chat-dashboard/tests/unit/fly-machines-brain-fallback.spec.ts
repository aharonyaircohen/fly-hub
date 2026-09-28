/**
 * @fileoverview Regression guard for Fly Live machines showing Brain apps.
 * @testFramework vitest
 * @domain runner
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../node_modules/@kody-ade/fly/src/routes/fly-machines.ts",
  ),
  "utf8",
);
describe("Fly machines ownership", () => {
  it("does not mix the personal Brain into repository inventory", () => {
    expect(ROUTE_SOURCE).not.toContain("appendSavedBrainMachineToInventory");
  });
});
