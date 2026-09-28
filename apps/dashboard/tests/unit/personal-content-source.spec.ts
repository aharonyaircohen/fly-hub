import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { viewRendererSourceForScope } from "@dashboard/lib/view-renderers/renderer-row";

const read = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("personal content ownership", () => {
  it("returns personal commands as personal content", () => {
    const source = read("src/dashboard/lib/personal-documents.ts");
    expect(source).toContain('source: "personal"');
    expect(source).not.toContain('source: "repo" as const');
  });

  it("maps account renderer rows to personal content", () => {
    expect(viewRendererSourceForScope(false, "repo")).toBe("personal");
    expect(viewRendererSourceForScope(true, "repo")).toBe("repo");
    expect(viewRendererSourceForScope(false, "builtin")).toBe("builtin");
  });
});
