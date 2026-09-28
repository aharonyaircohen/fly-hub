import { describe, expect, it } from "vitest";
import {
  canPerformMemoryAction,
  createMemory,
  createMemoryRevision,
  reviseMemory,
} from "../src/index";

const CREATED_AT = "2026-07-25T10:00:00.000Z";
const REVISED_AT = "2026-07-25T11:00:00.000Z";

describe("memory domain", () => {
  it("creates a small immutable user memory", () => {
    const memory = createMemory({
      id: "memory-1",
      scope: { kind: "user", userId: "user-1" },
      kind: "preference",
      content: {
        title: " Reply style ",
        summary: " Prefers short and simple replies. ",
        body: " Use simple words and lead with the answer. ",
      },
      currentRevisionId: "revision-1",
      status: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    expect(memory).toEqual({
      id: "memory-1",
      scope: { kind: "user", userId: "user-1" },
      kind: "preference",
      content: {
        title: "Reply style",
        summary: "Prefers short and simple replies.",
        body: "Use simple words and lead with the answer.",
      },
      currentRevisionId: "revision-1",
      status: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    expect(Object.isFrozen(memory)).toBe(true);
    expect(Object.isFrozen(memory.scope)).toBe(true);
    expect(Object.isFrozen(memory.content)).toBe(true);
  });

  it("supports repository scope without mixing it into user scope", () => {
    const memory = createMemory({
      id: "memory-2",
      scope: { kind: "repository", tenantId: "acme/widgets" },
      kind: "decision",
      content: {
        title: "Runtime state",
        summary: "Runtime state stays in Convex.",
        body: "Do not use GitHub as a runtime-state fallback.",
      },
      currentRevisionId: "revision-2",
      status: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    expect(memory.scope).toEqual({
      kind: "repository",
      tenantId: "acme/widgets",
    });
  });

  it("rejects unknown fields and invalid kinds", () => {
    expect(() =>
      createMemory({
        id: "memory-1",
        scope: { kind: "user", userId: "user-1" },
        kind: "feedback",
        content: {
          title: "Reply style",
          summary: "Prefers short replies.",
          body: "Keep replies short.",
        },
        currentRevisionId: "revision-1",
        status: "active",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        workflow: "legacy",
      }),
    ).toThrow(/unknown field "workflow"/i);

    expect(() =>
      createMemory({
        id: "memory-1",
        scope: { kind: "user", userId: "user-1" },
        kind: "feedback",
        content: {
          title: "Reply style",
          summary: "Prefers short replies.",
          body: "Keep replies short.",
        },
        currentRevisionId: "revision-1",
        status: "active",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    ).toThrow(/kind is invalid/i);
  });

  it("applies one explicit permission policy for users, engines, and systems", () => {
    const user = {
      actor: { kind: "user" as const, id: "user-1" },
      tenantIds: ["acme/widgets"],
    };
    const engine = {
      actor: { kind: "engine" as const, id: "memory-steward" },
      tenantIds: ["acme/widgets"],
    };
    const system = {
      actor: { kind: "system" as const, id: "memory-system" },
      tenantIds: ["acme/widgets"],
    };
    const personalScope = { kind: "user" as const, userId: "user-1" };
    const repositoryScope = {
      kind: "repository" as const,
      tenantId: "acme/widgets",
    };

    expect(canPerformMemoryAction(user, personalScope, "read")).toBe(true);
    expect(canPerformMemoryAction(user, personalScope, "write")).toBe(true);
    expect(canPerformMemoryAction(user, personalScope, "delete")).toBe(true);
    expect(canPerformMemoryAction(user, repositoryScope, "delete")).toBe(true);

    expect(canPerformMemoryAction(engine, repositoryScope, "read")).toBe(true);
    expect(canPerformMemoryAction(engine, repositoryScope, "write")).toBe(true);
    expect(canPerformMemoryAction(engine, repositoryScope, "delete")).toBe(
      false,
    );
    expect(canPerformMemoryAction(engine, personalScope, "read")).toBe(false);

    expect(canPerformMemoryAction(system, repositoryScope, "read")).toBe(false);
    expect(canPerformMemoryAction(system, repositoryScope, "write")).toBe(
      false,
    );
  });

  it("records evidence and actor on an immutable revision", () => {
    const revision = createMemoryRevision({
      id: "revision-1",
      memoryId: "memory-1",
      previousRevisionId: null,
      kind: "preference",
      content: {
        title: "Reply style",
        summary: "Prefers short replies.",
        body: "Lead with the answer.",
      },
      evidence: [
        {
          source: "message",
          id: "message-1",
          conversationId: "conversation-1",
        },
      ],
      reason: "Created from an explicit request.",
      actor: { kind: "user", id: "user-1" },
      createdAt: CREATED_AT,
    });

    expect(revision.evidence).toEqual([
      {
        source: "message",
        id: "message-1",
        conversationId: "conversation-1",
      },
    ]);
    expect(Object.isFrozen(revision.evidence)).toBe(true);
    expect(Object.isFrozen(revision.evidence[0])).toBe(true);
  });

  it("records manual user input as evidence without pretending it was a chat message", () => {
    const revision = createMemoryRevision({
      id: "revision-1",
      memoryId: "memory-1",
      previousRevisionId: null,
      kind: "fact",
      content: {
        title: "Manual fact",
        summary: "Entered directly by the user.",
        body: "This came from the memory editor.",
      },
      evidence: [{ source: "user-input", id: "request-1" }],
      reason: "Created manually.",
      actor: { kind: "user", id: "user-1" },
      createdAt: CREATED_AT,
    });

    expect(revision.evidence[0]).toEqual({
      source: "user-input",
      id: "request-1",
    });
  });

  it("revises a memory without mutating the earlier value", () => {
    const original = createMemory({
      id: "memory-1",
      scope: { kind: "user", userId: "user-1" },
      kind: "preference",
      content: {
        title: "Reply style",
        summary: "Prefers detailed replies.",
        body: "Give detailed answers.",
      },
      currentRevisionId: "revision-1",
      status: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    const result = reviseMemory(original, {
      revisionId: "revision-2",
      kind: "preference",
      content: {
        title: "Reply style",
        summary: "Prefers short replies.",
        body: "Use simple words and keep replies short.",
      },
      evidence: [{ source: "message", id: "message-2" }],
      reason: "The user corrected the earlier preference.",
      actor: { kind: "user", id: "user-1" },
      createdAt: REVISED_AT,
    });

    expect(result.memory).toMatchObject({
      currentRevisionId: "revision-2",
      updatedAt: REVISED_AT,
      content: { summary: "Prefers short replies." },
    });
    expect(result.revision).toMatchObject({
      id: "revision-2",
      memoryId: "memory-1",
      previousRevisionId: "revision-1",
    });
    expect(original.currentRevisionId).toBe("revision-1");
    expect(original.content.summary).toBe("Prefers detailed replies.");
  });

  it("rejects malformed records, timestamps, scopes, and statuses", () => {
    expect(() => createMemory(null)).toThrow(/must be an object/i);
    expect(() =>
      createMemory({
        id: "memory-1",
        scope: { kind: "team", id: "team-1" },
        kind: "fact",
        content: {
          title: "Fact",
          summary: "A useful fact.",
          body: "A useful fact body.",
        },
        currentRevisionId: "revision-1",
        status: "active",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    ).toThrow(/scope kind is invalid/i);
    expect(() =>
      createMemory({
        id: "memory-1",
        scope: { kind: "user", userId: "user-1", tenantId: "acme/widgets" },
        kind: "fact",
        content: {
          title: "Fact",
          summary: "A useful fact.",
          body: "A useful fact body.",
        },
        currentRevisionId: "revision-1",
        status: "active",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    ).toThrow(/unknown field "tenantId"/i);
    expect(() =>
      createMemory({
        id: "memory-1",
        scope: { kind: "user", userId: "user-1" },
        kind: "fact",
        content: {
          title: "Fact",
          summary: "A useful fact.",
          body: "A useful fact body.",
        },
        currentRevisionId: "revision-1",
        status: "deleted",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    ).toThrow(/status is invalid/i);
    expect(() =>
      createMemory({
        id: "memory-1",
        scope: { kind: "user", userId: "user-1" },
        kind: "fact",
        content: {
          title: "Fact",
          summary: "A useful fact.",
          body: "A useful fact body.",
        },
        currentRevisionId: "revision-1",
        status: "active",
        createdAt: "not-a-date",
        updatedAt: CREATED_AT,
      }),
    ).toThrow(/ISO timestamp/i);
    expect(() =>
      createMemory({
        id: "memory-1",
        scope: { kind: "user", userId: "user-1" },
        kind: "fact",
        content: {
          title: "Fact",
          summary: "A useful fact.",
          body: "A useful fact body.",
        },
        currentRevisionId: "revision-1",
        status: "active",
        createdAt: REVISED_AT,
        updatedAt: CREATED_AT,
      }),
    ).toThrow(/before createdAt/i);
  });

  it("supports expiration and optional evidence links", () => {
    const memory = createMemory({
      id: "memory-1",
      scope: { kind: "user", userId: "user-1" },
      kind: "reference",
      content: {
        title: "Temporary reference",
        summary: "Ship the first memory release.",
        body: "This reference expires after the release.",
      },
      currentRevisionId: "revision-1",
      status: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      expiresAt: "2026-08-25T10:00:00.000Z",
    });
    const revision = createMemoryRevision({
      id: "revision-1",
      memoryId: "memory-1",
      previousRevisionId: "revision-0",
      kind: "reference",
      content: memory.content,
      evidence: [
        {
          source: "document",
          id: "document-1",
          uri: "https://example.test/document-1",
        },
      ],
      reason: "Imported from an approved document.",
      actor: { kind: "system", id: "memory-system" },
      createdAt: CREATED_AT,
    });

    expect(memory.expiresAt).toBe("2026-08-25T10:00:00.000Z");
    expect(revision.evidence[0]?.uri).toBe("https://example.test/document-1");
  });

  it("rejects invalid revisions and revision ordering", () => {
    expect(() =>
      createMemoryRevision({
        id: "revision-1",
        memoryId: "memory-1",
        previousRevisionId: null,
        kind: "fact",
        content: {
          title: "Fact",
          summary: "A useful fact.",
          body: "A useful fact body.",
        },
        evidence: [],
        reason: "Created.",
        actor: { kind: "system", id: "memory-system" },
        createdAt: CREATED_AT,
      }),
    ).toThrow(/evidence is required/i);
    expect(() =>
      createMemoryRevision({
        id: "revision-1",
        memoryId: "memory-1",
        previousRevisionId: null,
        kind: "fact",
        content: {
          title: "Fact",
          summary: "A useful fact.",
          body: "A useful fact body.",
        },
        evidence: [{ source: "unknown", id: "source-1" }],
        reason: "Created.",
        actor: { kind: "system", id: "memory-system" },
        createdAt: CREATED_AT,
      }),
    ).toThrow(/evidence source is invalid/i);
    expect(() =>
      createMemoryRevision({
        id: "revision-1",
        memoryId: "memory-1",
        previousRevisionId: null,
        kind: "fact",
        content: {
          title: "Fact",
          summary: "A useful fact.",
          body: "A useful fact body.",
        },
        evidence: [{ source: "message", id: "message-1" }],
        reason: "Created.",
        actor: { kind: "operator", id: "user-1" },
        createdAt: CREATED_AT,
      }),
    ).toThrow(/actor kind is invalid/i);

    const inactive = createMemory({
      id: "memory-1",
      scope: { kind: "user", userId: "user-1" },
      kind: "fact",
      content: {
        title: "Fact",
        summary: "A useful fact.",
        body: "A useful fact body.",
      },
      currentRevisionId: "revision-1",
      status: "expired",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    expect(() =>
      reviseMemory(inactive, {
        revisionId: "revision-2",
        kind: "fact",
        content: inactive.content,
        evidence: [{ source: "message", id: "message-2" }],
        reason: "Too late.",
        actor: { kind: "user", id: "user-1" },
        createdAt: REVISED_AT,
      }),
    ).toThrow(/only an active memory/i);

    const active = createMemory({ ...inactive, status: "active" });
    expect(() =>
      reviseMemory(active, {
        revisionId: "revision-2",
        kind: "fact",
        content: active.content,
        evidence: [{ source: "message", id: "message-2" }],
        reason: "Out of order.",
        actor: { kind: "user", id: "user-1" },
        createdAt: "2026-07-25T09:00:00.000Z",
      }),
    ).toThrow(/older than the current memory/i);
  });
});
