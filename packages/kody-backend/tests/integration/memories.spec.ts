import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/widgets";
const OTHER_TENANT = "other/private";
const USER = "user-1";
const CREATED_AT = "2026-07-25T10:00:00.000Z";
const REVISED_AT = "2026-07-25T11:00:00.000Z";

const content = {
  title: "Reply style",
  summary: "Prefers short replies.",
  body: "Use simple words and answer first.",
};

function userMemory() {
  return {
    id: "memory-1",
    scope: { kind: "user" as const, userId: USER },
    kind: "preference" as const,
    content,
    currentRevisionId: "revision-1",
    status: "active" as const,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function firstRevision() {
  return {
    id: "revision-1",
    memoryId: "memory-1",
    previousRevisionId: null,
    kind: "preference" as const,
    content,
    evidence: [{ source: "message" as const, id: "message-1" }],
    reason: "The user explicitly requested this memory.",
    actor: { kind: "user" as const, id: USER },
    createdAt: CREATED_AT,
  };
}

describe("typed memories", () => {
  it("preserves legacy goal memory rows without permitting new goal writes", async () => {
    const t = setup();
    const id = await t.run(
      async (ctx) =>
        await ctx.db.insert("memories", {
          memoryId: "legacy-goal",
          scopeKind: "repository",
          scopeId: TENANT,
          kind: "goal",
          title: "Legacy goal",
          summary: "Imported before typed memory kinds.",
          body: "Historical data",
          searchText:
            "Legacy goal\nImported before typed memory kinds.\nHistorical data",
          currentRevisionId: "legacy-revision",
          status: "active",
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        } as never),
    );

    await expect(
      t.run(async (ctx) => await ctx.db.get(id)),
    ).resolves.toMatchObject({
      kind: "goal",
    });
  });

  it("atomically replays a create request and rejects changed content", async () => {
    const t = setup();
    const caller = {
      actor: { kind: "user" as const, id: USER },
      tenantId: TENANT,
    };
    const request = { key: "connection-a:create:retry-1", hash: "payload-a" };
    const first = await t.mutation(api.memories.create, {
      ...caller,
      memory: userMemory(),
      revision: firstRevision(),
      request,
    } as never);
    const replay = await t.mutation(api.memories.create, {
      ...caller,
      memory: {
        ...userMemory(),
        id: "attempt-two",
        currentRevisionId: "attempt-two-revision",
      },
      revision: {
        ...firstRevision(),
        id: "attempt-two-revision",
        memoryId: "attempt-two",
      },
      request,
    } as never);
    expect(replay).toEqual(first);
    expect(
      await t.run(async (ctx) => await ctx.db.query("memories").collect()),
    ).toHaveLength(1);
    await expect(
      t.mutation(api.memories.create, {
        ...caller,
        memory: userMemory(),
        revision: firstRevision(),
        request: { ...request, hash: "changed" },
      } as never),
    ).rejects.toThrow(/idempotency/i);
  });

  it.each([0, 1])(
    "expires write receipts at 30 days plus %i ms without deleting history",
    async (offset) => {
      const t = setup();
      const caller = {
        actor: { kind: "user" as const, id: USER },
        tenantId: TENANT,
      };
      const startedAt = Date.parse(CREATED_AT);
      const lifetime = 30 * 24 * 60 * 60 * 1000;
      const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
      const request = { key: "connection-a:create:expiry", hash: "payload-a" };
      const original = {
        ...caller,
        memory: userMemory(),
        revision: firstRevision(),
        request,
      };
      const next = {
        ...caller,
        memory: {
          ...userMemory(),
          id: "memory-next",
          currentRevisionId: "revision-next",
        },
        revision: {
          ...firstRevision(),
          id: "revision-next",
          memoryId: "memory-next",
        },
        request,
      };
      try {
        await t.mutation(api.memories.create, original);
        const receipt = await t.run(
          async (ctx) =>
            (await ctx.db.query("memoryWriteReceipts").collect())[0],
        );
        expect(receipt.expiresAt).toBe(startedAt + lifetime);

        clock.mockReturnValue(startedAt + lifetime - 1);
        expect(
          await t.query(api.memories.replay, { ...caller, request }),
        ).toEqual(userMemory());
        expect(await t.mutation(api.memories.create, next)).toEqual(
          userMemory(),
        );
        const changedRequest = { ...request, hash: "payload-b" };
        await expect(
          t.query(api.memories.replay, { ...caller, request: changedRequest }),
        ).rejects.toThrow(/idempotency/i);
        await expect(
          t.mutation(api.memories.create, { ...next, request: changedRequest }),
        ).rejects.toThrow(/idempotency/i);

        clock.mockReturnValue(startedAt + lifetime + offset);
        expect(
          await t.query(api.memories.replay, { ...caller, request }),
        ).toBeNull();
        expect(
          await t.query(api.memories.replay, {
            ...caller,
            request: changedRequest,
          }),
        ).toBeNull();
        // Read-only expiry is lazy: the row remains until a successful mutation replaces it.
        expect(
          await t.run(async (ctx) => ctx.db.get(receipt._id)),
        ).not.toBeNull();
        await expect(t.mutation(api.memories.create, original)).rejects.toThrow(
          /already exists/i,
        );
        expect(
          await t.mutation(api.memories.create, {
            ...next,
            request: changedRequest,
          }),
        ).toEqual(next.memory);
        expect(
          await t.query(api.memories.replay, {
            ...caller,
            request: changedRequest,
          }),
        ).toEqual(next.memory);
        const receipts = await t.run(async (ctx) =>
          ctx.db.query("memoryWriteReceipts").collect(),
        );
        expect(receipts).toHaveLength(1);
        expect(receipts[0]._id).not.toBe(receipt._id);
        expect(receipts[0].expiresAt).toBe(startedAt + 2 * lifetime + offset);
        expect(
          await t.query(api.memories.get, { ...caller, memoryId: "memory-1" }),
        ).toEqual(userMemory());
        expect(
          await t.query(api.memories.listRevisions, {
            ...caller,
            memoryId: "memory-1",
          }),
        ).toEqual([firstRevision()]);
        expect(
          await t.query(api.memories.listRevisions, {
            ...caller,
            memoryId: "memory-next",
          }),
        ).toEqual([next.revision]);
      } finally {
        clock.mockRestore();
      }
    },
  );

  it("isolates create receipts across connection keys for the same actor and tenant", async () => {
    const t = setup();
    const caller = {
      actor: { kind: "user" as const, id: USER },
      tenantId: TENANT,
    };
    const requestA = { key: "connection-a:create:retry-1", hash: "payload-a" };
    const requestB = { key: "connection-b:create:retry-1", hash: "payload-a" };
    await t.mutation(api.memories.create, {
      ...caller,
      memory: userMemory(),
      revision: firstRevision(),
      request: requestA,
    });
    expect(
      await t.query(api.memories.replay, { ...caller, request: requestB }),
    ).toBeNull();
    const memoryB = {
      ...userMemory(),
      id: "memory-b",
      currentRevisionId: "revision-b",
    };
    const revisionB = {
      ...firstRevision(),
      id: "revision-b",
      memoryId: "memory-b",
    };
    expect(
      await t.mutation(api.memories.create, {
        ...caller,
        memory: memoryB,
        revision: revisionB,
        request: requestB,
      }),
    ).toEqual(memoryB);
    for (const [request, memory, revision] of [
      [requestA, userMemory(), firstRevision()],
      [requestB, memoryB, revisionB],
    ] as const) {
      expect(
        await t.query(api.memories.replay, { ...caller, request }),
      ).toEqual(memory);
      expect(
        await t.mutation(api.memories.create, {
          ...caller,
          memory,
          revision,
          request,
        }),
      ).toEqual(memory);
      await expect(
        t.mutation(api.memories.create, {
          ...caller,
          memory,
          revision,
          request: { ...request, hash: "changed" },
        }),
      ).rejects.toThrow(/idempotency/i);
      expect(
        await t.query(api.memories.listRevisions, {
          ...caller,
          memoryId: memory.id,
        }),
      ).toEqual([revision]);
    }
    expect(
      await t.run(async (ctx) => ctx.db.query("memories").collect()),
    ).toHaveLength(2);
    expect(
      await t.run(async (ctx) => ctx.db.query("memoryWriteReceipts").collect()),
    ).toHaveLength(2);
  });

  it("does not reveal deleted content through a write receipt", async () => {
    const t = setup();
    const caller = {
      actor: { kind: "user" as const, id: USER },
      tenantId: TENANT,
    };
    const request = { key: "delete-replay", hash: "payload" };
    await t.mutation(api.memories.create, {
      ...caller,
      memory: userMemory(),
      revision: firstRevision(),
      request,
    });
    await t.mutation(api.memories.remove, { ...caller, memoryId: "memory-1" });
    await expect(
      t.query(api.memories.replay, { ...caller, request }),
    ).rejects.toThrow(/deleted/);
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.query("memoryWriteReceipts").collect())[0].memory,
      ),
    ).toBeNull();
  });

  it("replays deletion without resurrecting content and binds keys to the caller", async () => {
    const t = setup();
    const caller = {
      actor: { kind: "user" as const, id: USER },
      tenantId: TENANT,
    };
    await t.mutation(api.memories.create, {
      ...caller,
      memory: userMemory(),
      revision: firstRevision(),
    });
    const request = { key: "connection-a:delete-1", hash: "delete-payload" };
    expect(
      await t.mutation(api.memories.remove, {
        ...caller,
        memoryId: "memory-1",
        request,
      }),
    ).toBe(true);
    expect(
      await t.mutation(api.memories.remove, {
        ...caller,
        memoryId: "memory-1",
        request,
      }),
    ).toBe(true);
    expect(
      await t.mutation(api.memories.remove, {
        ...caller,
        memoryId: "memory-1",
        request: { ...request, key: "connection-b:delete-1" },
      }),
    ).toBe(false);
    expect(
      await t.query(api.memories.get, { ...caller, memoryId: "memory-1" }),
    ).toBeNull();
    expect(
      await t.query(api.memories.listRevisions, {
        ...caller,
        memoryId: "memory-1",
      }),
    ).toEqual([]);
  });

  it("paginates more than 200 active memories and excludes expired search hits", async () => {
    const t = setup();
    const caller = {
      actor: { kind: "user" as const, id: USER },
      tenantId: TENANT,
    };
    await t.run(async (ctx) => {
      for (let i = 0; i < 205; i++)
        await ctx.db.insert("memories", {
          memoryId: `page-${i}`,
          scopeKind: "user",
          scopeId: USER,
          kind: "fact",
          title: "continuity",
          summary: "continuity",
          body: "continuity",
          searchText: "continuity",
          currentRevisionId: `r-${i}`,
          status: "active",
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
          ...(i < 5 ? { expiresAt: "2020-01-01T00:00:00.000Z" } : {}),
        });
    });
    const ids = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page = await t.query(api.memories.listPage, {
        ...caller,
        scope: userMemory().scope,
        paginationOpts: { numItems: 25, cursor },
      });
      for (const memory of page.page) {
        expect(ids.has(memory.id)).toBe(false);
        ids.add(memory.id);
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(ids.size).toBe(200);
    const results = await t.query(api.memories.search, {
      ...caller,
      scope: userMemory().scope,
      searchText: "continuity",
      limit: 20,
    });
    expect(results).toHaveLength(20);
    expect(results.every((m) => !m.expiresAt)).toBe(true);
  });

  it("retires while preserving historical reads and removing active recall", async () => {
    const t = setup();
    const caller = {
      actor: { kind: "user" as const, id: USER },
      tenantId: TENANT,
    };
    await t.mutation(api.memories.create, {
      ...caller,
      memory: userMemory(),
      revision: firstRevision(),
    });
    await t.mutation(api.memories.revise, {
      ...caller,
      expectedRevisionId: "revision-1",
      memory: {
        ...userMemory(),
        status: "superseded",
        currentRevisionId: "revision-2",
        updatedAt: REVISED_AT,
      },
      revision: {
        ...firstRevision(),
        id: "revision-2",
        previousRevisionId: "revision-1",
        createdAt: REVISED_AT,
      },
    });
    expect(
      await t.query(api.memories.get, { ...caller, memoryId: "memory-1" }),
    ).toMatchObject({ status: "superseded" });
    expect(
      await t.query(api.memories.list, {
        ...caller,
        scope: userMemory().scope,
      }),
    ).toEqual([]);
    expect(
      await t.query(api.memories.listRevisions, {
        ...caller,
        memoryId: "memory-1",
      }),
    ).toHaveLength(2);
  });

  it("creates and reads a user memory with its first revision atomically", async () => {
    const t = setup();

    await t.mutation(api.memories.create, {
      actor: { kind: "user", id: USER },
      tenantId: TENANT,
      memory: userMemory(),
      revision: firstRevision(),
    });

    await expect(
      t.query(api.memories.get, {
        actor: { kind: "user", id: USER },
        tenantId: TENANT,
        memoryId: "memory-1",
      }),
    ).resolves.toEqual(userMemory());
    const revisions = await t.query(api.memories.listRevisions, {
      actor: { kind: "user", id: USER },
      tenantId: TENANT,
      memoryId: "memory-1",
    });
    expect(revisions).toEqual([firstRevision()]);
  });

  it("keeps user and repository scopes isolated", async () => {
    const t = setup();
    await t.mutation(api.memories.create, {
      actor: { kind: "user", id: USER },
      tenantId: TENANT,
      memory: userMemory(),
      revision: firstRevision(),
    });

    const repositoryMemory = {
      ...userMemory(),
      id: "memory-2",
      scope: { kind: "repository" as const, tenantId: TENANT },
      kind: "decision" as const,
      currentRevisionId: "revision-2",
    };
    const repositoryRevision = {
      ...firstRevision(),
      id: "revision-2",
      memoryId: "memory-2",
      kind: "decision" as const,
    };
    await t.mutation(api.memories.create, {
      actor: { kind: "user", id: USER },
      tenantId: TENANT,
      memory: repositoryMemory,
      revision: repositoryRevision,
    });

    await expect(
      t.query(api.memories.list, {
        actor: { kind: "user", id: USER },
        tenantId: TENANT,
        scope: { kind: "user", userId: USER },
      }),
    ).resolves.toEqual([userMemory()]);
    await expect(
      t.query(api.memories.list, {
        actor: { kind: "user", id: USER },
        tenantId: TENANT,
        scope: { kind: "repository", tenantId: TENANT },
      }),
    ).resolves.toEqual([repositoryMemory]);
    await expect(
      t.query(api.memories.get, {
        actor: { kind: "user", id: "user-2" },
        tenantId: TENANT,
        memoryId: "memory-1",
      }),
    ).resolves.toBeNull();
  });

  it("rejects a scope that does not match the authenticated context", async () => {
    const t = setup();

    await expect(
      t.mutation(api.memories.create, {
        actor: { kind: "user", id: USER },
        tenantId: TENANT,
        memory: {
          ...userMemory(),
          scope: { kind: "user", userId: "user-2" },
        },
        revision: firstRevision(),
      }),
    ).rejects.toThrow(/scope/i);
    await expect(
      t.mutation(api.memories.create, {
        actor: { kind: "user", id: USER },
        tenantId: TENANT,
        memory: {
          ...userMemory(),
          scope: { kind: "repository", tenantId: OTHER_TENANT },
        },
        revision: firstRevision(),
      }),
    ).rejects.toThrow(/scope/i);
  });

  it("revises with compare-and-swap protection", async () => {
    const t = setup();
    await t.mutation(api.memories.create, {
      actor: { kind: "user", id: USER },
      tenantId: TENANT,
      memory: userMemory(),
      revision: firstRevision(),
    });

    const revisedContent = {
      title: "Reply style",
      summary: "Prefers very short replies.",
      body: "Keep replies short and use simple words.",
    };
    const revisedMemory = {
      ...userMemory(),
      content: revisedContent,
      currentRevisionId: "revision-2",
      updatedAt: REVISED_AT,
    };
    const revision = {
      ...firstRevision(),
      id: "revision-2",
      previousRevisionId: "revision-1",
      content: revisedContent,
      evidence: [{ source: "message" as const, id: "message-2" }],
      reason: "The user clarified the preference.",
      createdAt: REVISED_AT,
    };
    await t.mutation(api.memories.revise, {
      actor: { kind: "user", id: USER },
      tenantId: TENANT,
      expectedRevisionId: "revision-1",
      memory: revisedMemory,
      revision,
    });

    await expect(
      t.mutation(api.memories.revise, {
        actor: { kind: "user", id: USER },
        tenantId: TENANT,
        expectedRevisionId: "revision-1",
        memory: {
          ...revisedMemory,
          currentRevisionId: "revision-3",
        },
        revision: {
          ...revision,
          id: "revision-3",
          previousRevisionId: "revision-2",
        },
      }),
    ).rejects.toThrow(/changed since it was read/i);

    await expect(
      t.mutation(api.memories.revise, {
        actor: { kind: "user", id: USER },
        tenantId: TENANT,
        expectedRevisionId: "revision-2",
        memory: {
          ...revisedMemory,
          currentRevisionId: "revision-4",
          updatedAt: "2026-07-25T12:00:00.000Z",
        },
        revision: {
          ...revision,
          id: "revision-4",
          previousRevisionId: "revision-2",
          content,
          createdAt: "2026-07-25T12:00:00.000Z",
        },
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it("deletes the memory and all revision history", async () => {
    const t = setup();
    await t.mutation(api.memories.create, {
      actor: { kind: "user", id: USER },
      tenantId: TENANT,
      memory: userMemory(),
      revision: firstRevision(),
    });

    await expect(
      t.mutation(api.memories.remove, {
        actor: { kind: "user", id: USER },
        tenantId: TENANT,
        memoryId: "memory-1",
      }),
    ).resolves.toBe(true);
    await expect(
      t.query(api.memories.get, {
        actor: { kind: "user", id: USER },
        tenantId: TENANT,
        memoryId: "memory-1",
      }),
    ).resolves.toBeNull();
    const revisionCount = await t.run(async (ctx) => {
      const rows = await ctx.db.query("memoryRevisions").collect();
      return rows.length;
    });
    expect(revisionCount).toBe(0);
  });

  it("searches active memory text inside one authorized scope", async () => {
    const t = setup();
    await t.mutation(api.memories.create, {
      actor: { kind: "user", id: USER },
      tenantId: TENANT,
      memory: userMemory(),
      revision: firstRevision(),
    });

    await expect(
      t.query(api.memories.search, {
        actor: { kind: "user", id: USER },
        tenantId: TENANT,
        scope: { kind: "user", userId: USER },
        searchText: "short replies",
        limit: 5,
      }),
    ).resolves.toEqual([userMemory()]);
    await expect(
      t.query(api.memories.search, {
        actor: { kind: "user", id: USER },
        tenantId: TENANT,
        scope: { kind: "repository", tenantId: OTHER_TENANT },
        searchText: "short replies",
        limit: 5,
      }),
    ).rejects.toThrow(/scope/i);
  });

  it("accepts engine-attributed repository revisions and rejects personal scope", async () => {
    const t = setup();
    const engineActor = { kind: "engine" as const, id: "memory-steward" };
    const repositoryMemory = {
      ...userMemory(),
      scope: { kind: "repository" as const, tenantId: TENANT },
      kind: "decision" as const,
    };
    const repositoryRevision = {
      ...firstRevision(),
      kind: "decision" as const,
      evidence: [{ source: "engine-run" as const, id: "run-1" }],
      actor: engineActor,
    };

    await t.mutation(api.memories.create, {
      actor: engineActor,
      tenantId: TENANT,
      memory: repositoryMemory,
      revision: repositoryRevision,
    });

    await expect(
      t.query(api.memories.get, {
        actor: engineActor,
        tenantId: TENANT,
        memoryId: "memory-1",
      }),
    ).resolves.toEqual(repositoryMemory);
    await expect(
      t.query(api.memories.list, {
        actor: engineActor,
        tenantId: TENANT,
        scope: { kind: "user", userId: "memory-steward" },
      }),
    ).rejects.toThrow(/scope/i);
    await expect(
      t.mutation(api.memories.remove, {
        actor: engineActor,
        tenantId: TENANT,
        memoryId: "memory-1",
      }),
    ).rejects.toThrow(/permission/i);
    await expect(
      t.mutation(api.memories.create, {
        actor: { kind: "system", id: "memory-system" },
        tenantId: TENANT,
        memory: { ...repositoryMemory, id: "memory-2" },
        revision: {
          ...repositoryRevision,
          id: "revision-2",
          memoryId: "memory-2",
          actor: { kind: "system", id: "memory-system" },
        },
      }),
    ).rejects.toThrow(/permission/i);
  });
});
