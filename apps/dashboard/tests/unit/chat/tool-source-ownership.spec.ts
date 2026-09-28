import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("chat tool source ownership", () => {
  it("keeps one implementation for every package-owned tool", () => {
    const packageFiles = new Set(
      globSync(
        "../../packages/kody-chat-dashboard/app/api/kody/chat/tools/*.ts",
      ).map((file) => basename(file)),
    );
    const duplicateImplementations = globSync("app/api/kody/chat/tools/*.ts")
      .filter((file) => packageFiles.has(basename(file)))
      .filter((file) => {
        const meaningfulLines = readFileSync(file, "utf8")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        return meaningfulLines.length > 2;
      });

    expect(duplicateImplementations).toEqual([]);
  });
});
