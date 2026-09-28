import { describe, expect, it, vi } from "vitest";

import { createDurableTurnProgressRecorder } from "../../app/api/kody/chat/durable-turn-progress";

describe("durable turn progress recorder", () => {
  it("publishes one coherent reasoning and tool snapshot", () => {
    const recordProgress = vi.fn();
    const progress = createDurableTurnProgressRecorder({ recordProgress });

    progress.appendReasoning("Checking ");
    progress.appendReasoning("the repository.");
    progress.upsertTool({
      id: "tool-1",
      name: "read_file",
      arguments: { path: "README.md" },
      status: "running",
    });
    progress.finishTool("tool-1", "success");

    expect(recordProgress).toHaveBeenLastCalledWith({
      reasoning: "Checking the repository.",
      toolCalls: [
        {
          id: "tool-1",
          name: "read_file",
          arguments: { path: "README.md" },
          status: "success",
        },
      ],
    });
  });
});
