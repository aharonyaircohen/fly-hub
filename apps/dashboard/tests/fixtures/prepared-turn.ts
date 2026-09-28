import type { PreparedConversationTurn } from "@kody-ade/kody-chat-dashboard/core/conversation/prepare-turn";

export const preparedTurnFixture: PreparedConversationTurn = {
  conversationId: "conversation-1",
  scope: { kind: "global" },
  runtime: { kind: "direct", modelId: "test-model" },
  speaker: { slug: "kody", title: "Kody" },
  agentEpochId: "initial",
  currentMessage: {
    kind: "message",
    id: "current",
    seq: 0,
    role: "user",
    author: { kind: "user", actorId: "github:test" },
    content: "hi",
    status: "committed",
    createdAt: "2026-07-20T00:00:00.000Z",
  },
  activeHistory: [],
  previousAgentContext: [],
  summary: null,
};
