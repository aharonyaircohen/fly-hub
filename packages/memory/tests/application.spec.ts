import { describe, expect, it } from "vitest";
import {
  MemoryAccessDeniedError,
  MemoryConflictError,
  MemoryNotFoundError,
  createMemoryApplication,
  type Memory,
  type MemoryRevision,
  type MemoryScope,
  type MemoryStore,
} from "../src/index";

class InMemoryStore implements MemoryStore {
  readonly memories = new Map<string, Readonly<Memory>>();
  readonly revisions = new Map<string, Readonly<MemoryRevision>>();

  async create(
    memory: Readonly<Memory>,
    revision: Readonly<MemoryRevision>,
  ): Promise<void> {
    if (this.memories.has(memory.id)) throw new Error("duplicate memory");
    this.memories.set(memory.id, memory);
    this.revisions.set(revision.id, revision);
  }

  async get(id: string): Promise<Readonly<Memory> | null> {
    return this.memories.get(id) ?? null;
  }

  async list(
    scopes: readonly MemoryScope[],
  ): Promise<readonly Readonly<Memory>[]> {
    return [...this.memories.values()].filter((memory) =>
      scopes.some(
        (scope) =>
          scope.kind === memory.scope.kind &&
          (scope.kind === "user"
            ? scope.userId ===
              (memory.scope as Extract<MemoryScope, { kind: "user" }>).userId
            : scope.tenantId ===
              (memory.scope as Extract<MemoryScope, { kind: "repository" }>)
                .tenantId),
      ),
    );
  }

  async listRevisions(
    memoryId: string,
  ): Promise<readonly Readonly<MemoryRevision>[]> {
    return [...this.revisions.values()].filter(
      (revision) => revision.memoryId === memoryId,
    );
  }

  async search(
    scopes: readonly MemoryScope[],
    query: string,
    limit: number,
  ): Promise<readonly Readonly<Memory>[]> {
    const words = query.toLowerCase();
    return (await this.list(scopes))
      .filter((memory) =>
        [memory.content.title, memory.content.summary, memory.content.body]
          .join(" ")
          .toLowerCase()
          .includes(words),
      )
      .slice(0, limit);
  }

  async revise(
    memory: Readonly<Memory>,
    revision: Readonly<MemoryRevision>,
  ): Promise<void> {
    this.memories.set(memory.id, memory);
    this.revisions.set(revision.id, revision);
  }

  async remove(id: string): Promise<boolean> {
    return this.memories.delete(id);
  }
}

function createTestApplication() {
  const store = new InMemoryStore();
  const ids = ["memory-1", "revision-1", "revision-2"];
  const times = ["2026-07-25T10:00:00.000Z", "2026-07-25T11:00:00.000Z"];
  const application = createMemoryApplication({
    store,
    nextId: () => {
      const id = ids.shift();
      if (!id) throw new Error("no test id");
      return id;
    },
    now: () => {
      const time = times.shift();
      if (!time) throw new Error("no test time");
      return time;
    },
  });
  return { application, store };
}

const principal = {
  actor: { kind: "user" as const, id: "user-1" },
  tenantIds: ["acme/widgets"],
};

const enginePrincipal = {
  actor: { kind: "engine" as const, id: "memory-steward" },
  tenantIds: ["acme/widgets"],
};

const systemPrincipal = {
  actor: { kind: "system" as const, id: "memory-system" },
  tenantIds: ["acme/widgets"],
};

describe("memory application", () => {
  it("remembers an explicit user memory with its first revision", async () => {
    const { application, store } = createTestApplication();

    const memory = await application.remember({
      principal,
      scope: { kind: "user", userId: "user-1" },
      kind: "preference",
      content: {
        title: "Reply style",
        summary: "Prefers short replies.",
        body: "Use simple words and answer first.",
      },
      evidence: [{ source: "message", id: "message-1" }],
      reason: "The user explicitly asked Kody to remember this.",
    });

    expect(memory.id).toBe("memory-1");
    expect(store.memories.get("memory-1")).toEqual(memory);
    expect(store.revisions.get("revision-1")).toMatchObject({
      memoryId: "memory-1",
      previousRevisionId: null,
      actor: { kind: "user", id: "user-1" },
    });
  });

  it("rejects writes outside the caller's scope", async () => {
    const { application, store } = createTestApplication();

    await expect(
      application.remember({
        principal,
        scope: { kind: "repository", tenantId: "other/private" },
        kind: "fact",
        content: {
          title: "Private repository",
          summary: "A fact from another repository.",
          body: "This must not be written.",
        },
        evidence: [{ source: "message", id: "message-1" }],
        reason: "Unauthorized test.",
      }),
    ).rejects.toBeInstanceOf(MemoryAccessDeniedError);
    expect(store.memories.size).toBe(0);
  });

  it("lets the memory steward write repository memory with engine attribution", async () => {
    const { application, store } = createTestApplication();

    await application.remember({
      principal: enginePrincipal,
      scope: { kind: "repository", tenantId: "acme/widgets" },
      kind: "decision",
      content: {
        title: "Package manager",
        summary: "This repository uses pnpm.",
        body: "Use pnpm for repository commands and dependency changes.",
      },
      evidence: [{ source: "engine-run", id: "run-1" }],
      reason: "A completed run provided strong repository evidence.",
    });

    expect(store.revisions.get("revision-1")).toMatchObject({
      actor: { kind: "engine", id: "memory-steward" },
      evidence: [{ source: "engine-run", id: "run-1" }],
    });
  });

  it("never lets the memory steward read or write personal memory", async () => {
    const { application } = createTestApplication();

    await expect(
      application.remember({
        principal: enginePrincipal,
        scope: { kind: "user", userId: "memory-steward" },
        kind: "fact",
        content: {
          title: "Personal detail",
          summary: "Automation must not create personal memory.",
          body: "Run learning is restricted to repository memory.",
        },
        evidence: [{ source: "engine-run", id: "run-1" }],
        reason: "This write must be rejected.",
      }),
    ).rejects.toBeInstanceOf(MemoryAccessDeniedError);
    await expect(
      application.list({
        principal: enginePrincipal,
        scopes: [{ kind: "user", userId: "memory-steward" }],
      }),
    ).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  });

  it("never lets the memory steward delete repository memory", async () => {
    const { application, store } = createTestApplication();
    await application.remember({
      principal: enginePrincipal,
      scope: { kind: "repository", tenantId: "acme/widgets" },
      kind: "fact",
      content: {
        title: "Runtime owner",
        summary: "Convex owns runtime state.",
        body: "Repository runtime state is stored in Convex.",
      },
      evidence: [{ source: "engine-run", id: "run-1" }],
      reason: "A completed run confirmed this repository fact.",
    });

    await expect(
      application.forget({
        principal: enginePrincipal,
        memoryId: "memory-1",
      }),
    ).rejects.toBeInstanceOf(MemoryAccessDeniedError);
    expect(store.memories.has("memory-1")).toBe(true);
  });

  it("never gives a system actor direct memory access", async () => {
    const { application, store } = createTestApplication();

    await expect(
      application.remember({
        principal: systemPrincipal,
        scope: { kind: "repository", tenantId: "acme/widgets" },
        kind: "fact",
        content: {
          title: "System record",
          summary: "System actors are audit identities only.",
          body: "A system actor must not call memory directly.",
        },
        evidence: [{ source: "engine-run", id: "run-1" }],
        reason: "This direct system write must be rejected.",
      }),
    ).rejects.toBeInstanceOf(MemoryAccessDeniedError);
    expect(store.memories.size).toBe(0);
  });

  it("corrects an accessible memory and keeps revision history", async () => {
    const { application, store } = createTestApplication();
    const created = await application.remember({
      principal,
      scope: { kind: "user", userId: "user-1" },
      kind: "preference",
      content: {
        title: "Reply style",
        summary: "Prefers detailed replies.",
        body: "Give detailed replies.",
      },
      evidence: [{ source: "message", id: "message-1" }],
      reason: "Initial preference.",
    });

    const corrected = await application.correct({
      principal,
      memoryId: created.id,
      kind: "preference",
      content: {
        title: "Reply style",
        summary: "Prefers short replies.",
        body: "Keep replies short and simple.",
      },
      evidence: [{ source: "message", id: "message-2" }],
      reason: "The user corrected the earlier preference.",
    });

    expect(corrected.currentRevisionId).toBe("revision-2");
    expect(corrected.content.summary).toBe("Prefers short replies.");
    expect(store.revisions.size).toBe(2);
  });

  it("rejects stale corrections and retires memory with an auditable revision", async () => {
    const { application, store } = createTestApplication();
    const created = await application.remember({
      principal,
      scope: { kind: "user", userId: "user-1" },
      kind: "fact",
      content: { title: "Fact", summary: "Current", body: "Current body" },
      evidence: [{ source: "message", id: "message-1" }],
      reason: "Initial fact.",
    });
    await expect(
      application.correct({
        principal,
        memoryId: created.id,
        expectedRevisionId: "stale",
        kind: created.kind,
        content: created.content,
        evidence: [{ source: "message", id: "message-2" }],
        reason: "Stale correction.",
      }),
    ).rejects.toBeInstanceOf(MemoryConflictError);
    const retired = await application.retire({
      principal,
      memoryId: created.id,
      expectedRevisionId: created.currentRevisionId,
      evidence: [{ source: "message", id: "message-3" }],
      reason: "No longer current.",
    });
    expect(retired.status).toBe("superseded");
    expect(store.revisions.size).toBe(2);
  });

  it("does not reveal or change another user's memory", async () => {
    const { application, store } = createTestApplication();
    await application.remember({
      principal,
      scope: { kind: "user", userId: "user-1" },
      kind: "fact",
      content: {
        title: "Role",
        summary: "The user owns product architecture.",
        body: "The user owns product architecture decisions.",
      },
      evidence: [{ source: "message", id: "message-1" }],
      reason: "Explicit user fact.",
    });

    await expect(
      application.correct({
        principal: {
          actor: { kind: "user", id: "user-2" },
          tenantIds: [],
        },
        memoryId: "memory-1",
        kind: "fact",
        content: {
          title: "Changed role",
          summary: "Unauthorized change.",
          body: "This must not be written.",
        },
        evidence: [{ source: "message", id: "message-2" }],
        reason: "Unauthorized test.",
      }),
    ).rejects.toBeInstanceOf(MemoryNotFoundError);
    expect(store.memories.get("memory-1")?.content.title).toBe("Role");
    await expect(
      application.get({
        principal: {
          actor: { kind: "user", id: "user-2" },
          tenantIds: [],
        },
        memoryId: "memory-1",
      }),
    ).rejects.toBeInstanceOf(MemoryNotFoundError);
    await expect(
      application.history({
        principal: {
          actor: { kind: "user", id: "user-2" },
          tenantIds: [],
        },
        memoryId: "memory-1",
      }),
    ).rejects.toBeInstanceOf(MemoryNotFoundError);
  });

  it("lists only scopes requested and owned by the caller", async () => {
    const { application } = createTestApplication();
    await application.remember({
      principal,
      scope: { kind: "repository", tenantId: "acme/widgets" },
      kind: "decision",
      content: {
        title: "Runtime state",
        summary: "Runtime state stays in Convex.",
        body: "Convex is the runtime-state owner.",
      },
      evidence: [{ source: "message", id: "message-1" }],
      reason: "Approved project decision.",
    });

    await expect(
      application.list({
        principal,
        scopes: [{ kind: "repository", tenantId: "other/private" }],
      }),
    ).rejects.toBeInstanceOf(MemoryAccessDeniedError);
    await expect(
      application.list({
        principal,
        scopes: [{ kind: "repository", tenantId: "acme/widgets" }],
      }),
    ).resolves.toHaveLength(1);
  });

  it("forgets an accessible memory and hides missing ids", async () => {
    const { application, store } = createTestApplication();
    await application.remember({
      principal,
      scope: { kind: "user", userId: "user-1" },
      kind: "fact",
      content: {
        title: "Temporary fact",
        summary: "This fact should be removed.",
        body: "Forget this after the test.",
      },
      evidence: [{ source: "message", id: "message-1" }],
      reason: "Explicit user fact.",
    });

    await expect(
      application.forget({ principal, memoryId: "memory-1" }),
    ).resolves.toEqual({ deleted: true });
    expect(store.memories.size).toBe(0);
    await expect(
      application.forget({ principal, memoryId: "missing" }),
    ).rejects.toBeInstanceOf(MemoryNotFoundError);
  });

  it("reads an accessible memory and its revision history", async () => {
    const { application } = createTestApplication();
    const created = await application.remember({
      principal,
      scope: { kind: "user", userId: "user-1" },
      kind: "reference",
      content: {
        title: "Architecture reference",
        summary: "The approved architecture note.",
        body: "Use this note when changing memory.",
      },
      evidence: [{ source: "user-input", id: "request-1" }],
      reason: "Created manually.",
    });

    await expect(
      application.get({ principal, memoryId: created.id }),
    ).resolves.toEqual(created);
    await expect(
      application.history({ principal, memoryId: created.id }),
    ).resolves.toHaveLength(1);
  });

  it("searches only an accessible scope", async () => {
    const { application } = createTestApplication();
    await application.remember({
      principal,
      scope: { kind: "repository", tenantId: "acme/widgets" },
      kind: "decision",
      content: {
        title: "Runtime state",
        summary: "Convex owns runtime state.",
        body: "Never use GitHub as the runtime fallback.",
      },
      evidence: [{ source: "message", id: "message-1" }],
      reason: "Approved decision.",
    });

    await expect(
      application.search({
        principal,
        scopes: [{ kind: "repository", tenantId: "acme/widgets" }],
        query: "Convex",
        limit: 5,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      application.search({
        principal,
        scopes: [{ kind: "repository", tenantId: "other/private" }],
        query: "Convex",
        limit: 5,
      }),
    ).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  });
});
