/**
 * @fileoverview Source-level guard for the deployed Kody chat route timeout.
 * @testFramework vitest
 * @domain chat
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SOURCE = readFileSync(
  resolve(__dirname, "../../app/api/kody/chat/kody/route.ts"),
  "utf8",
);

describe("deployed Kody chat route duration", () => {
  it("allows enough time for a complete project assessment", () => {
    expect(ROUTE_SOURCE).toContain("export const maxDuration = 800;");
  });
});
