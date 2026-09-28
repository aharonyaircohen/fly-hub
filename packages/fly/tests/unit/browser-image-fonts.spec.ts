import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("Fly browser image fonts", () => {
  it("includes Noto's Hebrew glyphs", () => {
    const dockerfile = readFileSync(
      fileURLToPath(new URL("../../browser/Dockerfile", import.meta.url)),
      "utf8",
    );

    expect(dockerfile).toContain("fonts-noto-core");
  });
});
