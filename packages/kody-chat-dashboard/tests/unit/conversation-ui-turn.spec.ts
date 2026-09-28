import { describe, expect, it } from "vitest";
import { prepareUiConversationTurn } from "../../src/dashboard/lib/chat/core/conversation/prepare-ui-turn";

describe("prepareUiConversationTurn", () => {
  it("makes the new user message primary and old-agent messages background", () => {
    const turn = prepareUiConversationTurn({
      session: {
        id: "c1",
        title: "Risk",
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:03:00.000Z",
        messageCount: 2,
        agencyAgent: { slug: "ceo", title: "CEO" },
        agentHandoffs: [
          {
            id: "handoff-1",
            fromSlug: "ux",
            fromTitle: "UX",
            toSlug: "ceo",
            toTitle: "CEO",
            switchedAt: "2026-07-20T10:02:00.000Z",
          },
        ],
      },
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Review the UX",
          timestamp: "2026-07-20T10:00:00.000Z",
        },
        {
          id: "m2",
          role: "assistant",
          content: "Labels are unclear",
          timestamp: "2026-07-20T10:01:00.000Z",
        },
      ],
      current: {
        id: "m3",
        content: "What is the business risk?",
        timestamp: "2026-07-20T10:03:00.000Z",
      },
      runtime: { kind: "direct", modelId: "model-1" },
    });

    expect(turn.currentMessage.content).toBe("What is the business risk?");
    expect(turn.activeHistory).toEqual([]);
    expect(turn.previousAgentContext.map((item) => item.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect(turn.speaker.slug).toBe("ceo");
  });
});
