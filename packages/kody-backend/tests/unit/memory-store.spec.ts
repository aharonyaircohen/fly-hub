import type { Memory, MemoryRevision, MemoryScope } from "@kody-ade/memory";
import type { ConvexHttpClient } from "convex/browser";
import { describe, expect, it, vi } from "vitest";
import { createConvexMemoryStore } from "../../src/memory-store";

const context = {
  actor: { kind: "user" as const, id: "user-1" },
  tenantId: "acme/widgets",
};
const memory = {
  id: "memory-1",
  scope: { kind: "user", userId: context.actor.id },
  kind: "preference",
  content: {
    title: "Reply style",
    summary: "Prefers short replies.",
    body: "Use simple words.",
  },
  currentRevisionId: "revision-1",
  status: "active",
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
} satisfies Memory;
const revision = {
  id: "revision-1",
  memoryId: memory.id,
  previousRevisionId: null,
  kind: memory.kind,
  content: memory.content,
  evidence: [{ source: "message", id: "message-1" }],
  reason: "Explicit user request.",
  actor: context.actor,
  createdAt: memory.createdAt,
} satisfies MemoryRevision;

describe("Convex memory store", () => {
  function storeClient(client: {
    query: ReturnType<typeof vi.fn>;
    mutation: ReturnType<typeof vi.fn>;
  }): Pick<ConvexHttpClient, "query" | "mutation"> {
    return client as unknown as Pick<ConvexHttpClient, "query" | "mutation">;
  }

  it("passes the trusted caller context to every operation", async () => {
    const client = {
      query: vi.fn().mockResolvedValue(memory),
      mutation: vi.fn().mockResolvedValue(memory.id),
    };
    const store = createConvexMemoryStore(storeClient(client), context);
    const revisedMemory = {
      ...memory,
      currentRevisionId: "revision-2",
      updatedAt: "2026-07-25T11:00:00.000Z",
    } satisfies Memory;
    const revisedRevision = {
      ...revision,
      id: "revision-2",
      previousRevisionId: memory.currentRevisionId,
      createdAt: revisedMemory.updatedAt,
    } satisfies MemoryRevision;

    await store.create(memory, revision);
    await store.get(memory.id);
    await store.revise(revisedMemory, revisedRevision);
    await store.remove(memory.id);

    for (const call of [...client.query.mock.calls, ...client.mutation.mock.calls]) {
      expect(call[1]).toMatchObject(context);
    }
  });

  it("combines requested scopes without leaking adapter details", async () => {
    const repositoryMemory = {
      ...memory,
      id: "memory-2",
      scope: { kind: "repository", tenantId: context.tenantId },
    } satisfies Memory;
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce([memory])
        .mockResolvedValueOnce([repositoryMemory]),
      mutation: vi.fn(),
    };
    const store = createConvexMemoryStore(storeClient(client), context);
    const scopes: MemoryScope[] = [
      memory.scope,
      repositoryMemory.scope,
    ];

    await expect(store.list(scopes)).resolves.toEqual([
      memory,
      repositoryMemory,
    ]);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls.map((call) => call[1].scope)).toEqual(scopes);
  });

  it("uses the previous revision as the compare-and-swap key", async () => {
    const client = {
      query: vi.fn(),
      mutation: vi.fn().mockResolvedValue(memory.id),
    };
    const store = createConvexMemoryStore(storeClient(client), context);

    const revisedMemory = {
      ...memory,
      currentRevisionId: "revision-2",
      updatedAt: "2026-07-25T11:00:00.000Z",
    } satisfies Memory;
    const revisedRevision = {
      ...revision,
      id: "revision-2",
      previousRevisionId: memory.currentRevisionId,
      createdAt: revisedMemory.updatedAt,
    } satisfies MemoryRevision;

    await store.revise(revisedMemory, revisedRevision);

    expect(client.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedRevisionId: memory.currentRevisionId,
      }),
    );
  });

  it("searches each requested scope and respects the result limit", async () => {
    const client = {
      query: vi.fn().mockResolvedValue([memory]),
      mutation: vi.fn(),
    };
    const store = createConvexMemoryStore(storeClient(client), context);

    await expect(
      store.search([memory.scope], "short replies", 4),
    ).resolves.toEqual([memory]);
    expect(client.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: memory.scope,
        searchText: "short replies",
        limit: 4,
      }),
    );
  });
});
