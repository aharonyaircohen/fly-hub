import type {
  MemoryActor,
  Memory,
  MemoryRevision,
  MemoryScope,
  MemoryStore,
  MemoryWriteRequest,
} from "@kody-ade/memory";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

export interface MemoryCallerContext {
  readonly actor: Readonly<MemoryActor>;
  readonly tenantId: string;
}

type MemoryClient = Pick<ConvexHttpClient, "query" | "mutation">;

function transportRevision(revision: Readonly<MemoryRevision>) {
  return {
    ...revision,
    evidence: revision.evidence.map((item) => ({ ...item })),
  };
}

export function createConvexMemoryStore(
  client: MemoryClient,
  caller: Readonly<MemoryCallerContext>,
): MemoryStore {
  const callerArgs = {
    actor: caller.actor,
    tenantId: caller.tenantId,
  };

  return Object.freeze({
    async page(scope: MemoryScope, cursor: string | null, limit: number) {
      return await client.query(api.memories.listPage, {
        ...callerArgs,
        scope,
        paginationOpts: { cursor, numItems: limit },
      });
    },
    async replay(request: MemoryWriteRequest) {
      return await client.query(api.memories.replay, {
        ...callerArgs,
        request,
      });
    },
    async create(
      memory: Readonly<Memory>,
      revision: Readonly<MemoryRevision>,
      request?: MemoryWriteRequest,
    ): Promise<Readonly<Memory> | void> {
      const result = await client.mutation(api.memories.create, {
        ...callerArgs,
        memory,
        revision: transportRevision(revision),
        ...(request ? { request } : {}),
      });
      if (typeof result !== "string") return result;
    },

    async get(id: string): Promise<Readonly<Memory> | null> {
      return await client.query(api.memories.get, {
        ...callerArgs,
        memoryId: id,
      });
    },

    async list(
      scopes: readonly MemoryScope[],
    ): Promise<readonly Readonly<Memory>[]> {
      const results = await Promise.all(
        scopes.map((scope) =>
          client.query(api.memories.list, {
            ...callerArgs,
            scope,
          }),
        ),
      );
      return results.flat();
    },

    async listRevisions(
      memoryId: string,
    ): Promise<readonly Readonly<MemoryRevision>[]> {
      return await client.query(api.memories.listRevisions, {
        ...callerArgs,
        memoryId,
      });
    },

    async search(
      scopes: readonly MemoryScope[],
      searchText: string,
      limit: number,
    ): Promise<readonly Readonly<Memory>[]> {
      const results = await Promise.all(
        scopes.map((scope) =>
          client.query(api.memories.search, {
            ...callerArgs,
            scope,
            searchText,
            limit,
          }),
        ),
      );
      const unique = new Map<string, Readonly<Memory>>();
      for (const memory of results.flat()) unique.set(memory.id, memory);
      return [...unique.values()].slice(0, limit);
    },

    async revise(
      memory: Readonly<Memory>,
      revision: Readonly<MemoryRevision>,
      request?: MemoryWriteRequest,
    ): Promise<Readonly<Memory> | void> {
      if (revision.previousRevisionId === null) {
        throw new Error(
          "A revised memory must reference its previous revision",
        );
      }
      const result = await client.mutation(api.memories.revise, {
        ...callerArgs,
        expectedRevisionId: revision.previousRevisionId,
        memory,
        revision: transportRevision(revision),
        ...(request ? { request } : {}),
      });
      if (typeof result !== "string") return result;
    },

    async remove(id: string, request?: MemoryWriteRequest): Promise<boolean> {
      return await client.mutation(api.memories.remove, {
        ...callerArgs,
        memoryId: id,
        ...(request ? { request } : {}),
      });
    },
  });
}
