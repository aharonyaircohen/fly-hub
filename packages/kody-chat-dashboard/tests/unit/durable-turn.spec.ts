import { beforeEach, describe, expect, it, vi } from "vitest";

const mutation = vi.fn();

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ mutation }),
}));

import { startDurableTurn } from "../../app/api/kody/chat/durable-turn";

describe("durable turn progress", () => {
  beforeEach(() => {
    mutation.mockReset();
    mutation.mockResolvedValue("turn-document");
  });

  it("flushes the latest reasoning and tool activity before completion", async () => {
    const turn = startDurableTurn({
      tenantId: "tenant",
      conversationId: "conversation",
      turnId: "turn",
      backend: "direct",
      agent: { slug: "kody", title: "Kody" },
    });

    turn.recordProgress({
      reasoning: "Checking",
      toolCalls: [],
    });
    turn.recordProgress({
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
    await turn.complete("Done.");

    expect(mutation).toHaveBeenCalledTimes(3);
    expect(mutation.mock.calls[1]?.[1]).toMatchObject({
      tenantId: "tenant",
      conversationId: "conversation",
      turnId: "turn",
      progress: {
        reasoning: "Checking the repository.",
        toolCalls: [
          {
            id: "tool-1",
            name: "read_file",
            arguments: { path: "README.md" },
            status: "success",
          },
        ],
      },
    });
    expect(mutation.mock.calls[2]?.[1]).toMatchObject({ content: "Done." });
  });

  it("reports a rejected progress write without losing final completion", async () => {
    mutation
      .mockResolvedValueOnce("turn-document")
      .mockRejectedValueOnce(new Error("updateProgress is unavailable"))
      .mockResolvedValueOnce("turn-document");
    const onProgressError = vi.fn();
    const turn = startDurableTurn(
      {
        tenantId: "tenant",
        conversationId: "conversation",
        turnId: "turn",
        backend: "direct",
        agent: { slug: "kody", title: "Kody" },
      },
      { onProgressError },
    );

    turn.recordProgress({ reasoning: "Checking", toolCalls: [] });
    await turn.complete("Done.");

    expect(onProgressError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "updateProgress is unavailable" }),
    );
    expect(mutation).toHaveBeenCalledTimes(3);
  });

  it("ignores writes racing with intentional conversation cleanup", async () => {
    mutation
      .mockResolvedValueOnce("turn-document")
      .mockRejectedValueOnce(new Error("Conversation not found"))
      .mockRejectedValueOnce(new Error("Conversation not found"));
    const onProgressError = vi.fn();
    const turn = startDurableTurn(
      {
        tenantId: "tenant",
        conversationId: "conversation",
        turnId: "turn",
        backend: "direct",
        agent: { slug: "kody", title: "Kody" },
      },
      { onProgressError },
    );

    turn.recordProgress({ reasoning: "Checking", toolCalls: [] });

    await expect(turn.complete("Done.")).resolves.toBeUndefined();
    expect(onProgressError).not.toHaveBeenCalled();
  });
});
