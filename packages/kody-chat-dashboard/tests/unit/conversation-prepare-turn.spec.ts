import { describe, expect, it } from "vitest";
import {
  prepareConversationTurn,
  type Conversation,
  type ConversationEntry,
} from "../../src/dashboard/lib/chat/core/conversation/prepare-turn";

const conversation: Conversation = {
  id: "conversation-1",
  scope: { kind: "repository", owner: "acme", repo: "widgets" },
  title: "Review checkout",
  activeAgent: { slug: "ceo", title: "CEO" },
  runtime: { kind: "direct", modelId: "minimax/MiniMax-M3" },
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:06:00.000Z",
};

const entries: ConversationEntry[] = [
  {
    kind: "message",
    id: "message-1",
    seq: 0,
    role: "user",
    author: { kind: "user", actorId: "operator:alice" },
    content: "Review this checkout flow.",
    status: "committed",
    createdAt: "2026-07-20T10:00:00.000Z",
  },
  {
    kind: "message",
    id: "message-2",
    seq: 1,
    role: "assistant",
    author: { kind: "agent", slug: "ux", title: "UX Designer" },
    content: "I am the UX Designer. The form needs clearer labels.",
    status: "committed",
    createdAt: "2026-07-20T10:01:00.000Z",
  },
  {
    kind: "agent-handoff",
    id: "handoff-1",
    seq: 2,
    from: { slug: "ux", title: "UX Designer" },
    to: { slug: "ceo", title: "CEO" },
    createdAt: "2026-07-20T10:05:00.000Z",
  },
  {
    kind: "message",
    id: "message-3",
    seq: 3,
    role: "user",
    author: { kind: "user", actorId: "operator:alice" },
    content: "What is the business risk?",
    status: "committed",
    createdAt: "2026-07-20T10:06:00.000Z",
  },
];

describe("prepareConversationTurn", () => {
  it("keeps the current message separate from all history", () => {
    const turn = prepareConversationTurn({
      conversation,
      entries,
      currentMessageId: "message-3",
    });

    expect(turn.currentMessage.content).toBe("What is the business risk?");
    expect(turn.activeHistory).toEqual([]);
    expect(turn.previousAgentContext.map((message) => message.id)).toEqual([
      "message-1",
      "message-2",
    ]);
  });

  it("keeps the selected speaker separate from the selected runtime", () => {
    const turn = prepareConversationTurn({
      conversation,
      entries,
      currentMessageId: "message-3",
    });

    expect(turn.speaker).toEqual({ slug: "ceo", title: "CEO" });
    expect(turn.runtime).toEqual({
      kind: "direct",
      modelId: "minimax/MiniMax-M3",
    });
  });

  it("keeps same-agent turns as structured history", () => {
    const sameAgentEntries: ConversationEntry[] = [
      ...entries,
      {
        kind: "message",
        id: "message-4",
        seq: 4,
        role: "assistant",
        author: { kind: "agent", slug: "ceo", title: "CEO" },
        content: "The main risk is conversion loss.",
        status: "committed",
        createdAt: "2026-07-20T10:07:00.000Z",
      },
      {
        kind: "message",
        id: "message-5",
        seq: 5,
        role: "user",
        author: { kind: "user", actorId: "operator:alice" },
        content: "What should we do first?",
        status: "committed",
        createdAt: "2026-07-20T10:08:00.000Z",
      },
    ];

    const turn = prepareConversationTurn({
      conversation,
      entries: sameAgentEntries,
      currentMessageId: "message-5",
    });

    expect(turn.activeHistory.map((message) => message.id)).toEqual([
      "message-3",
      "message-4",
    ]);
    expect(turn.currentMessage.id).toBe("message-5");
  });

  it("uses a checkpoint only inside the current agent period", () => {
    const turn = prepareConversationTurn({
      conversation,
      entries,
      currentMessageId: "message-3",
      checkpoint: {
        version: 1,
        throughSeq: 1,
        agentEpochId: "handoff-1",
        summary: "The UX Designer reviewed checkout.",
        sourceHash: "source-1",
        createdAt: "2026-07-20T10:04:00.000Z",
      },
    });

    expect(turn.summary).toBeNull();
  });

  it("rejects a non-user message as the current request", () => {
    expect(() =>
      prepareConversationTurn({
        conversation,
        entries,
        currentMessageId: "message-2",
      }),
    ).toThrow("Current conversation message must be a committed user message");
  });

  it("rejects conversation messages after the current request", () => {
    expect(() =>
      prepareConversationTurn({
        conversation,
        entries: [
          ...entries,
          {
            kind: "message",
            id: "message-4",
            seq: 4,
            role: "assistant",
            author: { kind: "agent", slug: "ceo", title: "CEO" },
            content: "A later reply.",
            status: "committed",
            createdAt: "2026-07-20T10:07:00.000Z",
          },
        ],
        currentMessageId: "message-3",
      }),
    ).toThrow("Current conversation message is not the latest message");
  });

  it("rejects duplicate timeline sequence numbers", () => {
    expect(() =>
      prepareConversationTurn({
        conversation,
        entries: [
          ...entries,
          {
            kind: "message",
            id: "message-duplicate",
            seq: 3,
            role: "user",
            author: { kind: "user", actorId: "operator:alice" },
            content: "This sequence is invalid.",
            status: "committed",
            createdAt: "2026-07-20T10:06:01.000Z",
          },
        ],
        currentMessageId: "message-3",
      }),
    ).toThrow("Duplicate conversation sequence: 3");
  });

  it("applies a checkpoint only to history it actually covers", () => {
    const sameAgentEntries: ConversationEntry[] = [
      ...entries,
      {
        kind: "message",
        id: "message-4",
        seq: 4,
        role: "assistant",
        author: { kind: "agent", slug: "ceo", title: "CEO" },
        content: "The main risk is conversion loss.",
        status: "committed",
        createdAt: "2026-07-20T10:07:00.000Z",
      },
      {
        kind: "message",
        id: "message-5",
        seq: 5,
        role: "user",
        author: { kind: "user", actorId: "operator:alice" },
        content: "What should we do first?",
        status: "committed",
        createdAt: "2026-07-20T10:08:00.000Z",
      },
    ];

    const turn = prepareConversationTurn({
      conversation,
      entries: sameAgentEntries,
      currentMessageId: "message-5",
      checkpoint: {
        version: 1,
        throughSeq: 3,
        agentEpochId: "handoff-1",
        summary: "The CEO identified conversion loss as the main risk.",
        sourceHash: "source-2",
        createdAt: "2026-07-20T10:07:30.000Z",
      },
    });

    expect(turn.summary).toBe(
      "The CEO identified conversion loss as the main risk.",
    );
    expect(turn.activeHistory.map((message) => message.id)).toEqual([
      "message-4",
    ]);
  });
});
