import { describe, expect, it } from "vitest";
import {
  mapConversationDetail,
  reconcileConversationMessages,
} from "../../src/dashboard/lib/chat/core/conversation/conversation-session-store";

describe("conversation session store", () => {
  const renderedView = {
    action: "render_view" as const,
    view: "renderer" as const,
    id: "view-1",
    rendererSlug: "summary",
    rendererName: "Summary",
    resultTarget: "chat" as const,
    ui: { type: "text" as const, value: "Persisted result" },
    data: { status: "ready" },
  };

  it("hydrates messages and handoffs from the ordered canonical timeline", () => {
    const result = mapConversationDetail({
      conversation: {
        conversationId: "c1",
        scope: { kind: "repository", owner: "acme", repo: "widgets" },
        title: "Risk",
        pinned: false,
        activeAgent: { slug: "ceo", title: "CEO" },
        runtime: { kind: "direct", modelId: "model-1" },
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:03:00.000Z",
      },
      entries: [
        {
          entryId: "m1",
          seq: 0,
          entry: {
            kind: "message",
            role: "user",
            content: "Review this",
            status: "committed",
            createdAt: "2026-07-20T10:00:00.000Z",
          },
        },
        {
          entryId: "h1",
          seq: 1,
          entry: {
            kind: "agent-handoff",
            from: { slug: "ux", title: "UX" },
            to: { slug: "ceo", title: "CEO" },
            createdAt: "2026-07-20T10:02:00.000Z",
          },
        },
      ],
      turns: [],
      checkpoints: [],
    });

    expect(result.messages[0]).toMatchObject({ id: "m1", text: "Review this" });
    expect(result.session.agentHandoffs).toEqual([
      expect.objectContaining({ fromSlug: "ux", toSlug: "ceo" }),
    ]);
    expect(result.session.repository).toEqual({
      owner: "acme",
      repo: "widgets",
    });
    expect(result.session.machineAccess).toBe("none");
  });

  it("does not duplicate reasoning already stored in assistant content", () => {
    const result = mapConversationDetail({
      conversation: {
        conversationId: "c-reasoning",
        title: "Greeting",
        pinned: false,
        activeAgent: { slug: "kody", title: "Kody" },
        runtime: { kind: "direct", modelId: "model-1" },
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:00:01.000Z",
      },
      entries: [
        {
          entryId: "a1",
          seq: 0,
          entry: {
            kind: "message",
            role: "assistant",
            content: "<think>check greeting</think>\n\nHi there!",
            status: "committed",
            turnId: "turn-1",
            createdAt: "2026-07-20T10:00:01.000Z",
          },
        },
      ],
      turns: [
        {
          turnId: "turn-1",
          status: "completed",
          agent: { slug: "kody", title: "Kody" },
          startedAt: "2026-07-20T10:00:00.000Z",
          progress: {
            reasoning: "check greeting",
            toolCalls: [],
          },
        },
      ],
      checkpoints: [],
    });

    expect(result.messages[0]?.text).toBe(
      "<think>check greeting</think>\n\nHi there!",
    );
  });

  it("hydrates machine access independently from agent and model", () => {
    const result = mapConversationDetail({
      conversation: {
        conversationId: "c-machine",
        title: "Machine",
        pinned: false,
        activeAgent: { slug: "cto", title: "CTO" },
        runtime: { kind: "direct", modelId: "model-1" },
        machineAccess: "local",
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:03:00.000Z",
      },
      entries: [
        {
          entryId: "assistant:turn-failed",
          seq: 0,
          entry: {
            kind: "message",
            role: "assistant",
            content: "Provider fallback",
            status: "committed",
            turnId: "turn-failed",
            createdAt: "2026-07-20T10:00:01.000Z",
          },
        },
      ],
      turns: [],
      checkpoints: [],
    });

    expect(result.session).toMatchObject({
      agencyAgent: { slug: "cto", title: "CTO" },
      agentKey: "model-1",
      machineAccess: "local",
    });
  });

  it("migrates legacy Brain conversations without changing their runtime", () => {
    const result = mapConversationDetail({
      conversation: {
        conversationId: "c-brain",
        title: "Brain",
        pinned: false,
        activeAgent: { slug: "kody", title: "Kody" },
        runtime: { kind: "brain", brainId: "brain" },
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:03:00.000Z",
      },
      entries: [],
      turns: [],
      checkpoints: [],
    });

    expect(result.session.machineAccess).toBe("brain");
    expect(result.session.agentKey).toBe("brain");
  });

  it("keeps streaming assistant drafts out of durable storage", () => {
    const previous: (typeof pending)[] = [];
    const pending = {
      id: "a1",
      role: "assistant" as const,
      text: "",
      timestamp: "2026-07-20T10:00:00.000Z",
      isLoading: true,
    };
    const append = reconcileConversationMessages(previous, [pending]);
    const streamed = reconcileConversationMessages(
      [pending],
      [{ ...pending, text: "Still typing" }],
    );

    expect(append).toEqual([]);
    expect(streamed).toEqual([]);
  });

  it("appends the complete assistant message once streaming finishes", () => {
    const pending = {
      id: "a1",
      role: "assistant" as const,
      text: "Still typing",
      timestamp: "2026-07-20T10:00:00.000Z",
      isLoading: true,
    };

    expect(
      reconcileConversationMessages(
        [pending],
        [{ ...pending, text: "Done", isLoading: false }],
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "append",
        message: expect.objectContaining({
          id: "a1",
          text: "Done",
          isLoading: false,
        }),
      }),
    ]);
  });

  it("removes messages that the current chat no longer contains", () => {
    const removed = {
      id: "guided-flow-1",
      role: "assistant" as const,
      text: "GuidedFlow completed.",
      timestamp: "2026-07-20T10:00:00.000Z",
    };

    expect(reconcileConversationMessages([removed], [])).toEqual([
      { kind: "remove", message: removed },
    ]);
  });

  it("restores a validated rendered answer from canonical storage", () => {
    const result = mapConversationDetail({
      conversation: {
        conversationId: "c1",
        title: "Rendered answer",
        pinned: false,
        activeAgent: { slug: "kody", title: "Kody" },
        runtime: { kind: "direct", modelId: "model-1" },
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:03:00.000Z",
      },
      entries: [
        {
          entryId: "a1",
          seq: 0,
          entry: {
            kind: "message",
            role: "assistant",
            content: "",
            status: "committed",
            createdAt: "2026-07-20T10:00:00.000Z",
            view: renderedView,
          },
        },
      ],
      turns: [],
      checkpoints: [],
    });

    expect(result.messages[0]?.view).toEqual(renderedView);
  });

  it("restores a running durable turn as a loading assistant reply", () => {
    const result = mapConversationDetail({
      conversation: {
        conversationId: "c-running",
        title: "Pending reply",
        pinned: false,
        activeAgent: { slug: "kody", title: "Kody" },
        runtime: { kind: "direct", modelId: "model-1" },
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:00:01.000Z",
      },
      entries: [
        {
          entryId: "u1",
          seq: 0,
          entry: {
            kind: "message",
            role: "user",
            content: "Take your time",
            status: "committed",
            turnId: "u1",
            createdAt: "2026-07-20T10:00:00.000Z",
          },
        },
      ],
      turns: [
        {
          turnId: "turn-1",
          status: "running",
          agent: { slug: "kody", title: "Kody" },
          startedAt: "2026-07-20T10:00:01.000Z",
        },
      ],
      checkpoints: [],
    });

    expect(result.hasRunningTurns).toBe(true);
    expect(result.messages.at(-1)).toMatchObject({
      id: "assistant:turn-1",
      turnId: "turn-1",
      role: "assistant",
      text: "",
      isLoading: true,
      agent: { slug: "kody", title: "Kody" },
    });
  });

  it("keeps polling when the pending assistant entry was saved before the turn record", () => {
    const result = mapConversationDetail({
      conversation: {
        conversationId: "c-pending-entry",
        title: "Pending reply",
        pinned: false,
        activeAgent: { slug: "kody", title: "Kody" },
        runtime: { kind: "direct", modelId: "model-1" },
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:00:01.000Z",
      },
      entries: [
        {
          entryId: "assistant:turn-early",
          seq: 0,
          entry: {
            kind: "message",
            role: "assistant",
            content: "",
            status: "pending",
            turnId: "turn-early",
            createdAt: "2026-07-20T10:00:01.000Z",
          },
        },
      ],
      turns: [],
      checkpoints: [],
    });

    expect(result.hasRunningTurns).toBe(true);
    expect(result.messages[0]).toMatchObject({
      id: "assistant:turn-early",
      isLoading: true,
    });
  });

  it("restores reasoning and used tools from a running durable turn", () => {
    const result = mapConversationDetail({
      conversation: {
        conversationId: "c-progress",
        title: "Progress",
        pinned: false,
        activeAgent: { slug: "kody", title: "Kody" },
        runtime: { kind: "direct", modelId: "model-1" },
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:00:01.000Z",
      },
      entries: [
        {
          entryId: "assistant:turn-progress",
          seq: 0,
          entry: {
            kind: "message",
            role: "assistant",
            content: "",
            status: "pending",
            turnId: "turn-progress",
            createdAt: "2026-07-20T10:00:01.000Z",
          },
        },
      ],
      turns: [
        {
          turnId: "turn-progress",
          status: "running",
          agent: { slug: "kody", title: "Kody" },
          startedAt: "2026-07-20T10:00:01.000Z",
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
        },
      ],
      checkpoints: [],
    });

    expect(result.messages[0]).toMatchObject({
      text: "<think>Checking the repository.</think>\n\n",
      toolCalls: [
        {
          name: "read_file",
          arguments: { path: "README.md" },
          status: "success",
        },
      ],
      isLoading: true,
    });
  });

  it("does not duplicate a durable turn that already has an assistant entry", () => {
    const result = mapConversationDetail({
      conversation: {
        conversationId: "c-completed",
        title: "Completed reply",
        pinned: false,
        activeAgent: { slug: "kody", title: "Kody" },
        runtime: { kind: "direct", modelId: "model-1" },
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:01:00.000Z",
      },
      entries: [
        {
          entryId: "assistant:turn-1",
          seq: 0,
          entry: {
            kind: "message",
            role: "assistant",
            content: "Finished after refresh.",
            status: "committed",
            turnId: "turn-1",
            createdAt: "2026-07-20T10:01:00.000Z",
          },
        },
      ],
      turns: [
        {
          turnId: "turn-1",
          status: "completed",
          agent: { slug: "kody", title: "Kody" },
          assistantEntryId: "assistant:turn-1",
          startedAt: "2026-07-20T10:00:01.000Z",
          completedAt: "2026-07-20T10:01:00.000Z",
          progress: {
            reasoning: "Verified the final answer.",
            toolCalls: [
              {
                id: "tool-1",
                name: "read_file",
                arguments: { path: "README.md" },
                status: "success",
              },
            ],
          },
        },
      ],
      checkpoints: [],
    });

    expect(result.hasRunningTurns).toBe(false);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: "assistant:turn-1",
      text: "<think>Verified the final answer.</think>\n\nFinished after refresh.",
      toolCalls: [
        {
          name: "read_file",
          arguments: { path: "README.md" },
          status: "success",
        },
      ],
      isLoading: false,
    });
  });

  it("restores a failed durable turn as a retryable assistant error", () => {
    const result = mapConversationDetail({
      conversation: {
        conversationId: "c-failed",
        title: "Failed reply",
        pinned: false,
        activeAgent: { slug: "kody", title: "Kody" },
        runtime: { kind: "direct", modelId: "model-1" },
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:00:05.000Z",
      },
      entries: [],
      turns: [
        {
          turnId: "turn-failed",
          status: "failed",
          agent: { slug: "kody", title: "Kody" },
          startedAt: "2026-07-20T10:00:01.000Z",
          completedAt: "2026-07-20T10:00:05.000Z",
          errorCode: "provider_error",
          errorDetail:
            "Final report writing failed: unfinished output ‘length’.",
        },
      ],
      checkpoints: [],
    });

    expect(result.hasRunningTurns).toBe(false);
    expect(result.messages).toEqual([
      expect.objectContaining({
        id: "assistant:turn-failed",
        role: "assistant",
        text: "Final report writing failed: unfinished output ‘length’.",
        isLoading: false,
      }),
    ]);
  });

  it("persists a rendered answer added to an existing streaming message", () => {
    const pending = {
      id: "a1",
      role: "assistant" as const,
      text: "",
      timestamp: "2026-07-20T10:00:00.000Z",
      isLoading: true,
    };

    expect(
      reconcileConversationMessages(
        [pending],
        [{ ...pending, isLoading: false, view: renderedView }],
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "append",
        message: expect.objectContaining({ view: renderedView }),
      }),
    ]);
  });

  it("persists a completion result added to an existing rendered view", () => {
    const message = {
      id: "a1",
      role: "assistant" as const,
      text: "Widget opened.",
      timestamp: "2026-07-20T10:00:00.000Z",
      view: renderedView,
    };
    const completedView = {
      ...renderedView,
      result: {
        actionId: "correct",
        completedAt: "2026-08-01T12:00:00.000Z",
      },
    };

    expect(
      reconcileConversationMessages(
        [message],
        [{ ...message, view: completedView }],
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "update",
        message: expect.objectContaining({ view: completedView }),
      }),
    ]);
  });
});
