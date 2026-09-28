import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardRoot = resolve(import.meta.dirname, "../..");

describe("Brain terminal route registration", () => {
  it("registers personal Brain services for re-exported terminal routes", () => {
    for (const route of ["session", "setup"]) {
      const source = readFileSync(
        resolve(dashboardRoot, `app/api/kody/terminal/${route}/route.ts`),
        "utf8",
      );
      expect(source).toContain(
        'import "@dashboard/lib/brain/personal-services"',
      );
    }
  });
});
