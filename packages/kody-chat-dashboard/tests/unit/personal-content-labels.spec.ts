import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("personal content labels", () => {
  it("models personal commands and renderers explicitly", () => {
    const commands = readFileSync(
      "src/dashboard/lib/components/CommandsManager.tsx",
      "utf8",
    );
    const renderers = readFileSync(
      "src/dashboard/lib/components/ViewRenderersManager.tsx",
      "utf8",
    );

    expect(commands).toContain('source: "personal" | "repo"');
    expect(commands).toContain('p.source === "personal"');
    expect(renderers).toContain('source: "personal" | "repo"');
    expect(renderers).toContain(
      'selected?.source === "repo" || selected?.source === "personal"',
    );
  });
});
