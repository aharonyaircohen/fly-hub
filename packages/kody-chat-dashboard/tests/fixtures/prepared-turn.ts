import type { PreparedConversationTurn } from "../../src/dashboard/lib/chat/core/conversation/prepare-turn";

export const preparedTurnFixture: PreparedConversationTurn = {
  conversationId: "session-1",
  scope: { kind: "global" },
  speaker: { slug: "kody", title: "Kody" },
  runtime: { kind: "direct", modelId: "test-model" },
  agentEpochId: "initial",
  currentMessage: {
    kind: "message",
    id: "message-current",
    seq: 0,
    role: "user",
    author: { kind: "user", actorId: "test-user" },
    content: "hello",
    status: "committed",
    createdAt: "2026-07-20T10:00:00.000Z",
  },
  activeHistory: [],
  previousAgentContext: [],
  summary: null,
};
