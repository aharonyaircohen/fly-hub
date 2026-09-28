import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/widgets";
const NOW = "2026-07-20T10:00:00.000Z";

const conversation = {
  tenantId: TENANT,
  conversationId: "conversation-1",
  surface: "global" as const,
  scope: { kind: "repository" as const, owner: "acme", repo: "widgets" },
  title: "Review checkout",
  pinned: false,
  activeAgent: { slug: "ux", title: "UX Designer" },
  runtime: {
    kind: "direct" as const,
    modelId: "minimax/MiniMax-M3",
  },
  createdBy: "operator:alice",
  createdAt: NOW,
  updatedAt: NOW,
};

describe("conversations", () => {
  it("starts the first durable turn even when client-side creation is still in flight", async () => {
    const t = setup();
    await t.mutation(api.conversationTurns.start, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-first-send",
      backend: "direct",
      agent: conversation.activeAgent,
      startedAt: NOW,
      createIfMissing: {
        owner: "acme",
        repo: "widgets",
        modelId: "minimax/MiniMax-M3",
        createdBy: "operator:alice",
      },
    });

    await expect(
      t.mutation(api.conversations.create, conversation),
    ).resolves.toBeDefined();
    const stored = await t.query(api.conversations.get, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
    });
    expect(stored?.turns).toHaveLength(1);
    expect(stored?.conversation.activeAgent).toEqual(conversation.activeAgent);
  });

  it("owns a durable turn through one idempotent assistant commit", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);

    const started = await t.mutation(api.conversationTurns.start, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-durable-1",
      backend: "direct",
      agent: conversation.activeAgent,
      startedAt: NOW,
    });
    const retried = await t.mutation(api.conversationTurns.start, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-durable-1",
      backend: "direct",
      agent: conversation.activeAgent,
      startedAt: NOW,
    });

    await t.mutation(api.conversationTurns.complete, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-durable-1",
      content: "The durable answer.",
      completedAt: "2026-07-20T10:01:00.000Z",
    });
    await t.mutation(api.conversationTurns.complete, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-durable-1",
      content: "The durable answer.",
      completedAt: "2026-07-20T10:01:00.000Z",
    });

    const stored = await t.query(api.conversations.get, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
    });
    expect(retried).toBe(started);
    expect(stored?.turns).toHaveLength(1);
    expect(stored?.turns[0]).toMatchObject({
      turnId: "turn-durable-1",
      status: "completed",
      assistantEntryId: "assistant:turn-durable-1",
    });
    expect(stored?.entries).toHaveLength(1);
    expect(stored?.entries[0]).toMatchObject({
      entryId: "assistant:turn-durable-1",
      entry: {
        role: "assistant",
        content: "The durable answer.",
        status: "committed",
        turnId: "turn-durable-1",
      },
    });
  });

  it("keeps running reasoning and tool activity on the durable turn", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);
    await t.mutation(api.conversationTurns.start, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-progress",
      backend: "direct",
      agent: conversation.activeAgent,
      startedAt: NOW,
    });

    await t.mutation(api.conversationTurns.updateProgress, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-progress",
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
      updatedAt: "2026-07-20T10:00:30.000Z",
    });

    const stored = await t.query(api.conversations.get, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
    });
    expect(stored?.turns[0].progress).toEqual({
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

  it("keeps a failed turn's private synthesis checkpoint for a writer-only retry", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);
    await t.mutation(api.conversationTurns.start, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-assessment",
      backend: "direct",
      agent: conversation.activeAgent,
      startedAt: NOW,
    });

    await t.mutation(api.conversationTurns.saveRecovery, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-assessment",
      recovery: {
        kind: "project-assessment-synthesis",
        version: 1,
        system: "Write the standalone report.",
        userMessage: "Same-run specialist packets.",
        internalLinks: [],
        repository: { owner: "acme", repo: "widgets" },
        createdAt: NOW,
      },
      updatedAt: "2026-07-20T10:00:30.000Z",
    });
    await t.mutation(api.conversationTurns.fail, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-assessment",
      errorCode: "specialist_synthesis_failed",
      errorDetail: "missing_section (Advanced continuous QA)",
      failedAt: "2026-07-20T10:01:00.000Z",
    });

    const failed = await t.query(api.conversationTurns.get, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-assessment",
    });
    expect(failed).toMatchObject({
      status: "failed",
      errorDetail: "missing_section (Advanced continuous QA)",
      recovery: {
        kind: "project-assessment-synthesis",
        repository: { owner: "acme", repo: "widgets" },
      },
    });
  });

  it("removes the private synthesis checkpoint after a successful report", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);
    await t.mutation(api.conversationTurns.start, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-assessment-success",
      backend: "direct",
      agent: conversation.activeAgent,
      startedAt: NOW,
    });
    await t.mutation(api.conversationTurns.saveRecovery, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-assessment-success",
      recovery: {
        kind: "project-assessment-synthesis",
        version: 1,
        system: "Write the standalone report.",
        userMessage: "Same-run specialist packets.",
        internalLinks: [],
        repository: { owner: "acme", repo: "widgets" },
        createdAt: NOW,
      },
      updatedAt: NOW,
    });
    await t.mutation(api.conversationTurns.complete, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-assessment-success",
      content: "Saved report.",
      completedAt: "2026-07-20T10:01:00.000Z",
    });

    const completed = await t.query(api.conversationTurns.get, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-assessment-success",
    });
    expect(completed?.recovery).toBeUndefined();
  });

  it("rejects completion by an agent that is no longer active", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);
    await t.mutation(api.conversationTurns.start, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      turnId: "turn-stale-agent",
      backend: "direct",
      agent: conversation.activeAgent,
      startedAt: NOW,
    });
    await t.mutation(api.conversations.appendEntry, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      idempotencyKey: "handoff-before-completion",
      entryId: "handoff-before-completion",
      entry: {
        kind: "agent-handoff",
        from: conversation.activeAgent,
        to: { slug: "ceo", title: "CEO" },
        createdAt: "2026-07-20T10:00:30.000Z",
      },
    });

    await expect(
      t.mutation(api.conversationTurns.complete, {
        tenantId: TENANT,
        conversationId: conversation.conversationId,
        turnId: "turn-stale-agent",
        content: "Wrong identity",
        completedAt: "2026-07-20T10:01:00.000Z",
      }),
    ).rejects.toThrow("Turn agent must match the active agent");
  });

  it("stores a typed conversation and returns it only inside its tenant", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);

    const stored = await t.query(api.conversations.get, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
    });
    const inaccessible = await t.query(api.conversations.get, {
      tenantId: "other/tenant",
      conversationId: conversation.conversationId,
    });

    expect(stored?.conversation.title).toBe("Review checkout");
    expect(stored?.entries).toEqual([]);
    expect(inaccessible).toBeNull();
  });

  it("keeps repository context independent from conversation ownership", async () => {
    const t = setup();

    await expect(
      t.mutation(api.conversations.create, {
        ...conversation,
        tenantId: "user:42",
        scope: { kind: "repository", owner: "other", repo: "repo" },
      }),
    ).resolves.toBeDefined();
  });

  it("stores optional repository context inside a user-owned conversation", async () => {
    const t = setup();
    await expect(
      t.mutation(api.conversations.create, {
        ...conversation,
        tenantId: "user:42",
      }),
    ).resolves.toBeDefined();
  });

  it("appends entries in exact order and makes retries idempotent", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);

    const append = {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      idempotencyKey: "send-message-1",
      entryId: "message-1",
      entry: {
        kind: "message" as const,
        role: "user" as const,
        author: { kind: "user" as const, actorId: "operator:alice" },
        content: "What is the risk?",
        status: "committed" as const,
        turnId: "turn-1",
        createdAt: NOW,
      },
    };

    const firstId = await t.mutation(api.conversations.appendEntry, append);
    const retryId = await t.mutation(api.conversations.appendEntry, append);
    await t.mutation(api.conversations.appendEntry, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      idempotencyKey: "handoff-1",
      entryId: "handoff-1",
      entry: {
        kind: "agent-handoff",
        from: { slug: "ux", title: "UX Designer" },
        to: { slug: "ceo", title: "CEO" },
        createdAt: "2026-07-20T10:01:00.000Z",
      },
    });

    const stored = await t.query(api.conversations.get, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
    });

    expect(retryId).toBe(firstId);
    expect(
      stored?.entries.map(({ seq, entryId }) => ({ seq, entryId })),
    ).toEqual([
      { seq: 0, entryId: "message-1" },
      { seq: 1, entryId: "handoff-1" },
    ]);
  });

  it("rejects writes when the conversation belongs to another tenant", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);

    await expect(
      t.mutation(api.conversations.appendEntry, {
        tenantId: "other/tenant",
        conversationId: conversation.conversationId,
        idempotencyKey: "send-message-1",
        entryId: "message-1",
        entry: {
          kind: "message",
          role: "user",
          author: { kind: "user", actorId: "operator:mallory" },
          content: "Cross-tenant write",
          status: "committed",
          turnId: "turn-1",
          createdAt: NOW,
        },
      }),
    ).rejects.toThrow("Conversation not found");
  });

  it("stores typed checkpoints, runtime bindings, and attachment metadata", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);

    await t.mutation(api.conversations.saveCheckpoint, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      version: 1,
      throughSeq: 4,
      agentEpochId: "handoff-1",
      summary: "The CEO identified conversion risk.",
      sourceHash: "sha256:source",
      createdAt: "2026-07-20T10:10:00.000Z",
    });
    await t.mutation(api.conversations.bindRuntime, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      runtime: { kind: "brain", brainId: "brain-1" },
      remoteConversationId: "remote-chat-1",
      updatedAt: "2026-07-20T10:11:00.000Z",
    });
    await t.mutation(api.conversations.attachFile, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      attachment: {
        attachmentId: "attachment-1",
        entryId: "message-1",
        storageId: "storage-1",
        fileName: "checkout.png",
        mediaType: "image/png",
        sizeBytes: 2048,
        createdAt: "2026-07-20T10:12:00.000Z",
      },
    });

    const stored = await t.query(api.conversations.get, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
    });

    expect(stored?.checkpoints[0].summary).toContain("conversion risk");
    expect(stored?.runtimeBindings[0].runtime).toEqual({
      kind: "brain",
      brainId: "brain-1",
    });
    expect(stored?.attachments[0].attachment.fileName).toBe("checkout.png");
  });

  it("updates speaker and runtime independently", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);

    await t.mutation(api.conversations.appendEntry, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      idempotencyKey: "handoff-to-ceo",
      entryId: "handoff-to-ceo",
      entry: {
        kind: "agent-handoff",
        from: { slug: "ux", title: "UX Designer" },
        to: { slug: "ceo", title: "CEO" },
        createdAt: "2026-07-20T10:14:00.000Z",
      },
    });
    await t.mutation(api.conversations.updateRuntime, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      runtime: { kind: "brain", brainId: "brain-1" },
      updatedAt: "2026-07-20T10:15:00.000Z",
    });

    const stored = await t.query(api.conversations.get, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
    });
    expect(stored?.conversation.activeAgent.slug).toBe("ceo");
    expect(stored?.conversation.runtime.kind).toBe("brain");
  });

  it("sets the selected agent before the first message but requires a handoff later", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);
    await t.mutation(api.conversations.setInitialAgent, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      activeAgent: { slug: "ceo", title: "CEO" },
      updatedAt: "2026-07-20T10:01:00.000Z",
    });
    await t.mutation(api.conversations.appendEntry, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      idempotencyKey: "message-after-selection",
      entryId: "message-after-selection",
      entry: {
        kind: "message",
        role: "user",
        author: { kind: "user", actorId: "operator:alice" },
        content: "Who are you?",
        status: "committed",
        turnId: "message-after-selection",
        createdAt: "2026-07-20T10:02:00.000Z",
      },
    });

    await expect(
      t.mutation(api.conversations.setInitialAgent, {
        tenantId: TENANT,
        conversationId: conversation.conversationId,
        activeAgent: { slug: "coo", title: "COO" },
        updatedAt: "2026-07-20T10:03:00.000Z",
      }),
    ).rejects.toThrow("requires an agent handoff");
  });

  it("updates one streaming message instead of appending duplicate deltas", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);
    await t.mutation(api.conversations.appendEntry, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      idempotencyKey: "assistant-1",
      entryId: "assistant-1",
      entry: {
        kind: "message",
        role: "assistant",
        author: { kind: "agent", slug: "ux", title: "UX Designer" },
        content: "",
        status: "pending",
        turnId: "turn-1",
        createdAt: NOW,
      },
    });

    await t.mutation(api.conversations.updateMessage, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      entryId: "assistant-1",
      content: "Conversion risk is high.",
      status: "committed",
      updatedAt: "2026-07-20T10:01:00.000Z",
    });

    const stored = await t.query(api.conversations.get, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
    });
    expect(stored?.entries).toHaveLength(1);
    expect(stored?.entries[0].entry).toMatchObject({
      content: "Conversion risk is high.",
      status: "committed",
    });
  });

  it("persists title and pin metadata without changing the transcript", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);
    await t.mutation(api.conversations.updateMetadata, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      title: "Checkout risk",
      pinned: true,
      updatedAt: "2026-07-20T10:02:00.000Z",
    });

    const stored = await t.query(api.conversations.get, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
    });
    expect(stored?.conversation).toMatchObject({
      title: "Checkout risk",
      pinned: true,
    });
    expect(stored?.entries).toEqual([]);
  });

  it("deletes the conversation and all owned records", async () => {
    const t = setup();
    await t.mutation(api.conversations.create, conversation);
    await t.mutation(api.conversations.appendEntry, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
      idempotencyKey: "message-1",
      entryId: "message-1",
      entry: {
        kind: "message",
        role: "user",
        author: { kind: "user", actorId: "operator:alice" },
        content: "Delete this later.",
        status: "committed",
        turnId: "turn-1",
        createdAt: NOW,
      },
    });

    await t.mutation(api.conversations.remove, {
      tenantId: TENANT,
      conversationId: conversation.conversationId,
    });

    expect(
      await t.query(api.conversations.get, {
        tenantId: TENANT,
        conversationId: conversation.conversationId,
      }),
    ).toBeNull();
  });
});
