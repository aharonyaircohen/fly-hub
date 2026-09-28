import { describe, expect, it } from "vitest";
import {
  buildConversationContext,
  createConversationCheckpoint,
  estimateConversationTokens,
  planConversationCompaction,
  type CompactableMessage,
} from "../../src/dashboard/lib/chat/core/conversation-compaction";

function message(content: string, role: "user" | "assistant" = "user") {
  return { role, content } satisfies CompactableMessage;
}

describe("conversation compaction", () => {
  it("estimates the rendered conversation size", () => {
    expect(estimateConversationTokens([message("a".repeat(400))])).toBe(104);
  });

  it("does not compact a conversation below the token threshold", () => {
    const plan = planConversationCompaction({
      messages: [
        message("small question"),
        message("small answer", "assistant"),
      ],
      nextUserContent: "continue",
      triggerTokens: 100,
      recentTokens: 20,
    });

    expect(plan).toBeNull();
  });

  it("forces a manual compaction while retaining the latest two messages", () => {
    const messages = [
      message("first decision"),
      message("first answer", "assistant"),
      message("latest question"),
      message("latest answer", "assistant"),
    ];

    const plan = planConversationCompaction({
      messages,
      nextUserContent: "",
      force: true,
      recentTokens: 0,
    });

    expect(plan?.messagesToSummarize).toEqual(messages.slice(0, 2));
    expect(plan?.recentMessages).toEqual(messages.slice(2));
  });

  it("compacts older messages while retaining the recent tail", () => {
    const messages = Array.from({ length: 8 }, (_, index) =>
      message(`${index}:${"x".repeat(80)}`, index % 2 ? "assistant" : "user"),
    );

    const plan = planConversationCompaction({
      messages,
      nextUserContent: "continue",
      triggerTokens: 100,
      recentTokens: 50,
    });

    expect(plan).not.toBeNull();
    expect(plan!.messagesToSummarize.length).toBeGreaterThan(0);
    expect(plan!.throughMessageCount).toBeLessThan(messages.length);
    expect(messages.slice(plan!.throughMessageCount)).toEqual(
      plan!.recentMessages,
    );
  });

  it("uses a valid checkpoint and only summarizes new older messages", () => {
    const original = Array.from({ length: 6 }, (_, index) =>
      message(`${index}:${"x".repeat(80)}`, index % 2 ? "assistant" : "user"),
    );
    const first = createConversationCheckpoint({
      summary: "The user is implementing compaction.",
      messages: original,
      throughMessageCount: 3,
      previousRevision: 0,
      createdAt: "2026-07-14T00:00:00.000Z",
    });
    const messages = [
      ...original,
      ...Array.from({ length: 4 }, (_, index) =>
        message(
          `new-${index}:${"y".repeat(80)}`,
          index % 2 ? "assistant" : "user",
        ),
      ),
    ];

    const plan = planConversationCompaction({
      messages,
      checkpoint: first,
      nextUserContent: "continue",
      triggerTokens: 100,
      recentTokens: 50,
    });

    expect(plan).not.toBeNull();
    expect(plan!.previousSummary).toBe(first.summary);
    expect(plan!.messagesToSummarize).toEqual(
      messages.slice(first.throughMessageCount, plan!.throughMessageCount),
    );
  });

  it("ignores a checkpoint when the summarized transcript was edited", () => {
    const messages = [message("first"), message("second", "assistant")];
    const checkpoint = createConversationCheckpoint({
      summary: "Old summary",
      messages,
      throughMessageCount: 1,
      previousRevision: 0,
      createdAt: "2026-07-14T00:00:00.000Z",
    });
    const edited = [message("changed"), messages[1]];

    expect(buildConversationContext(edited, checkpoint)).toEqual({
      summary: null,
      recentMessages: edited,
      checkpoint: null,
    });
  });

  it("returns the summary and unsummarized messages for the next model turn", () => {
    const messages = [
      message("old"),
      message("answer", "assistant"),
      message("recent"),
    ];
    const checkpoint = createConversationCheckpoint({
      summary: "The old exchange established the goal.",
      messages,
      throughMessageCount: 2,
      previousRevision: 1,
      createdAt: "2026-07-14T00:00:00.000Z",
    });

    expect(buildConversationContext(messages, checkpoint)).toEqual({
      summary: checkpoint.summary,
      recentMessages: [messages[2]],
      checkpoint,
    });
  });
});
