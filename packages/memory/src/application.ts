import {
  canPerformMemoryAction,
  createMemory,
  createMemoryRevision,
  reviseMemory,
  type EvidenceRef,
  type Memory,
  type MemoryAction,
  type MemoryContent,
  type MemoryKind,
  type MemoryPrincipal,
  type MemoryRevision,
  type MemoryScope,
} from "./domain";

export interface MemoryWriteRequest {
  readonly key: string;
  readonly hash: string;
}

export interface MemoryStore {
  page?(
    scope: MemoryScope,
    cursor: string | null,
    limit: number,
  ): Promise<{
    page: readonly Readonly<Memory>[];
    isDone: boolean;
    continueCursor: string;
  }>;

  replay?(request: MemoryWriteRequest): Promise<Readonly<Memory> | null>;
  create(
    memory: Readonly<Memory>,
    revision: Readonly<MemoryRevision>,
    request?: MemoryWriteRequest,
  ): Promise<Readonly<Memory> | void>;
  get(id: string): Promise<Readonly<Memory> | null>;
  list(scopes: readonly MemoryScope[]): Promise<readonly Readonly<Memory>[]>;
  listRevisions(memoryId: string): Promise<readonly Readonly<MemoryRevision>[]>;
  search(
    scopes: readonly MemoryScope[],
    query: string,
    limit: number,
  ): Promise<readonly Readonly<Memory>[]>;
  revise(
    memory: Readonly<Memory>,
    revision: Readonly<MemoryRevision>,
    request?: MemoryWriteRequest,
  ): Promise<Readonly<Memory> | void>;
  remove(id: string, request?: MemoryWriteRequest): Promise<boolean>;
}

export class MemoryAccessDeniedError extends Error {
  constructor() {
    super("Memory access denied");
    this.name = "MemoryAccessDeniedError";
  }
}

export class MemoryNotFoundError extends Error {
  constructor() {
    super("Memory not found");
    this.name = "MemoryNotFoundError";
  }
}

export class MemoryConflictError extends Error {
  constructor() {
    super("Memory revision is stale");
    this.name = "MemoryConflictError";
  }
}

interface MemoryApplicationDependencies {
  readonly store: MemoryStore;
  readonly nextId: () => string;
  readonly now: () => string;
}

interface RememberCommand {
  readonly request?: MemoryWriteRequest;
  readonly principal: Readonly<MemoryPrincipal>;
  readonly scope: MemoryScope;
  readonly kind: MemoryKind;
  readonly content: Readonly<MemoryContent>;
  readonly evidence: readonly Readonly<EvidenceRef>[];
  readonly reason: string;
  readonly expiresAt?: string;
}

interface CorrectCommand {
  readonly request?: MemoryWriteRequest;
  readonly principal: Readonly<MemoryPrincipal>;
  readonly memoryId: string;
  readonly kind: MemoryKind;
  readonly content: Readonly<MemoryContent>;
  readonly evidence: readonly Readonly<EvidenceRef>[];
  readonly reason: string;
  readonly expectedRevisionId?: string;
  readonly expiresAt?: string;
}

interface RetireCommand {
  readonly request?: MemoryWriteRequest;
  readonly principal: Readonly<MemoryPrincipal>;
  readonly memoryId: string;
  readonly expectedRevisionId?: string;
  readonly reason: string;
  readonly evidence: readonly Readonly<EvidenceRef>[];
}

interface ForgetCommand {
  readonly request?: MemoryWriteRequest;
  readonly principal: Readonly<MemoryPrincipal>;
  readonly memoryId: string;
}

interface ListCommand {
  readonly principal: Readonly<MemoryPrincipal>;
  readonly scopes: readonly MemoryScope[];
}

interface GetCommand {
  readonly principal: Readonly<MemoryPrincipal>;
  readonly memoryId: string;
}

interface SearchCommand extends ListCommand {
  readonly query: string;
  readonly limit: number;
}

function requireAccessibleScopes(
  principal: Readonly<MemoryPrincipal>,
  scopes: readonly MemoryScope[],
): void {
  if (
    scopes.some((scope) => !canPerformMemoryAction(principal, scope, "read"))
  ) {
    throw new MemoryAccessDeniedError();
  }
}

async function findAccessibleMemory(
  store: MemoryStore,
  principal: Readonly<MemoryPrincipal>,
  memoryId: string,
  action: MemoryAction,
): Promise<Readonly<Memory>> {
  const memory = await store.get(memoryId);
  if (!memory) {
    throw new MemoryNotFoundError();
  }
  if (!canPerformMemoryAction(principal, memory.scope, action)) {
    if (!canPerformMemoryAction(principal, memory.scope, "read")) {
      throw new MemoryNotFoundError();
    }
    throw new MemoryAccessDeniedError();
  }
  return memory;
}

export function createMemoryApplication({
  store,
  nextId,
  now,
}: MemoryApplicationDependencies) {
  return Object.freeze({
    async get(command: GetCommand): Promise<Readonly<Memory>> {
      return await findAccessibleMemory(
        store,
        command.principal,
        command.memoryId,
        "read",
      );
    },

    async history(
      command: GetCommand,
    ): Promise<readonly Readonly<MemoryRevision>[]> {
      await findAccessibleMemory(
        store,
        command.principal,
        command.memoryId,
        "read",
      );
      return await store.listRevisions(command.memoryId);
    },

    async remember(command: RememberCommand): Promise<Readonly<Memory>> {
      if (!canPerformMemoryAction(command.principal, command.scope, "write")) {
        throw new MemoryAccessDeniedError();
      }
      const memoryId = nextId();
      const revisionId = nextId();
      const createdAt = now();
      const revision = createMemoryRevision({
        id: revisionId,
        memoryId,
        previousRevisionId: null,
        kind: command.kind,
        content: command.content,
        evidence: command.evidence,
        reason: command.reason,
        actor: command.principal.actor,
        createdAt,
      });
      const memory = createMemory({
        id: memoryId,
        scope: command.scope,
        kind: command.kind,
        content: command.content,
        currentRevisionId: revisionId,
        status: "active",
        createdAt,
        updatedAt: createdAt,
        ...(command.expiresAt === undefined
          ? {}
          : { expiresAt: command.expiresAt }),
      });
      return (await store.create(memory, revision, command.request)) ?? memory;
    },

    async correct(command: CorrectCommand): Promise<Readonly<Memory>> {
      const current = await findAccessibleMemory(
        store,
        command.principal,
        command.memoryId,
        "write",
      );
      if (command.request && store.replay) {
        const replay = await store.replay(command.request);
        if (replay) return replay;
      }
      if (
        command.request === undefined &&
        command.expectedRevisionId !== undefined &&
        command.expectedRevisionId !== current.currentRevisionId
      ) {
        throw new MemoryConflictError();
      }
      const result = reviseMemory(current, {
        revisionId: nextId(),
        kind: command.kind,
        content: command.content,
        evidence: command.evidence,
        reason: command.reason,
        actor: command.principal.actor,
        createdAt: now(),
      });
      const revised =
        command.expiresAt === undefined
          ? result.memory
          : createMemory({ ...result.memory, expiresAt: command.expiresAt });
      return (
        (await store.revise(
          revised,
          {
            ...result.revision,
            previousRevisionId:
              command.expectedRevisionId ?? result.revision.previousRevisionId,
          },
          command.request,
        )) ?? revised
      );
    },

    async retire(command: RetireCommand): Promise<Readonly<Memory>> {
      const current = await findAccessibleMemory(
        store,
        command.principal,
        command.memoryId,
        "write",
      );
      if (command.request && store.replay) {
        const replay = await store.replay(command.request);
        if (replay) return replay;
      }
      if (
        command.request === undefined &&
        command.expectedRevisionId !== undefined &&
        command.expectedRevisionId !== current.currentRevisionId
      ) {
        throw new MemoryConflictError();
      }
      const result = reviseMemory(current, {
        revisionId: nextId(),
        kind: current.kind,
        content: current.content,
        evidence: command.evidence,
        reason: command.reason,
        actor: command.principal.actor,
        createdAt: now(),
      });
      const retired = createMemory({ ...result.memory, status: "superseded" });
      return (
        (await store.revise(
          retired,
          {
            ...result.revision,
            previousRevisionId:
              command.expectedRevisionId ?? result.revision.previousRevisionId,
          },
          command.request,
        )) ?? retired
      );
    },

    async forget(command: ForgetCommand): Promise<Readonly<{ deleted: true }>> {
      try {
        await findAccessibleMemory(
          store,
          command.principal,
          command.memoryId,
          "delete",
        );
      } catch (error) {
        if (!(error instanceof MemoryNotFoundError) || !command.request)
          throw error;
      }
      const deleted = await store.remove(command.memoryId, command.request);
      if (!deleted) throw new MemoryNotFoundError();
      return Object.freeze({ deleted: true });
    },

    async page(
      command: ListCommand & {
        scope: MemoryScope;
        cursor: string | null;
        limit: number;
      },
    ) {
      requireAccessibleScopes(command.principal, [command.scope]);
      if (!store.page) throw new Error("Memory pagination is unavailable");
      return store.page(command.scope, command.cursor, command.limit);
    },

    async list(command: ListCommand): Promise<readonly Readonly<Memory>[]> {
      requireAccessibleScopes(command.principal, command.scopes);
      return store.list(command.scopes);
    },

    async search(command: SearchCommand): Promise<readonly Readonly<Memory>[]> {
      requireAccessibleScopes(command.principal, command.scopes);
      const query = command.query.trim();
      if (!query) throw new Error("Memory search query is required");
      if (
        !Number.isInteger(command.limit) ||
        command.limit < 1 ||
        command.limit > 20
      ) {
        throw new Error("Memory search limit must be between 1 and 20");
      }
      return store.search(command.scopes, query, command.limit);
    },
  });
}
