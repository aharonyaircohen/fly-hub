import { describe, expect, it } from "vitest";
import { formatMemoryPrompt } from "../../src/memory/retrieval";

describe("memory prompt retrieval", () => {
  it("returns no prompt when retrieval found nothing", () => {
    expect(formatMemoryPrompt([])).toBeNull();
  });

  it("formats only retrieved memories with scope and kind", () => {
    const prompt = formatMemoryPrompt([
      {
        id: "memory-1",
        scope: { kind: "user", userId: "user-1" },
        kind: "preference",
        content: {
          title: "Reply style",
          summary: "Prefers short replies.",
          body: "Use simple words.",
        },
        currentRevisionId: "revision-1",
        status: "active",
        createdAt: "2026-07-25T10:00:00.000Z",
        updatedAt: "2026-07-25T10:00:00.000Z",
      },
    ]);

    expect(prompt).toContain("## Relevant memory");
    expect(prompt).toContain("kind: preference | scope: personal");
    expect(prompt).toContain("Use simple words.");
  });
});
