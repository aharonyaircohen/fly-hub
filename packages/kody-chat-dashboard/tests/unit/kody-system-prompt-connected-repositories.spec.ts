import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "@kody-ade/base/kody-system-prompt";

describe("Kody system prompt connected repositories", () => {
  it("preserves explicit cross-repository source and target context", () => {
    const prompt = buildSystemPrompt(
      "Base prompt",
      { owner: "acme", repo: "target" },
      undefined,
      {
        connectedRepositories: [
          { owner: "acme", repo: "source" },
          { owner: "acme", repo: "target" },
        ],
      },
    );

    expect(prompt).toContain("## Connected repositories");
    expect(prompt).toContain("acme/source");
    expect(prompt).toContain("acme/target (current)");
    expect(prompt).toContain("explicitly names a source and target");
  });
});
