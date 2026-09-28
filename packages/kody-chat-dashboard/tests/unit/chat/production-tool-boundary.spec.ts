import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production chat tool ownership", () => {
  it("never imports test fixtures from production chat code", () => {
    const offenders = globSync("app/api/kody/chat/**/*.ts").filter((file) =>
      /tests\/fixtures\/|standalone-report-fixtures/.test(
        readFileSync(file, "utf8"),
      ),
    );

    expect(offenders).toEqual([]);
  });
});
