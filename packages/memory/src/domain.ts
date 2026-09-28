export type MemoryKind =
  "preference" | "fact" | "decision" | "reference";

export type MemoryStatus = "active" | "superseded" | "expired";

export type MemoryScope =
  | Readonly<{ kind: "user"; userId: string }>
  | Readonly<{ kind: "repository"; tenantId: string }>;

export interface MemoryContent {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
}

export interface Memory {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly kind: MemoryKind;
  readonly content: Readonly<MemoryContent>;
  readonly currentRevisionId: string;
  readonly status: MemoryStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
}

export type EvidenceSource =
  | "user-input"
  | "conversation"
  | "message"
  | "pull-request"
  | "document"
  | "engine-run";

export interface EvidenceRef {
  readonly source: EvidenceSource;
  readonly id: string;
  readonly conversationId?: string;
  readonly uri?: string;
}

export interface MemoryActor {
  readonly kind: "user" | "system" | "engine";
  readonly id: string;
}

export interface MemoryRevision {
  readonly id: string;
  readonly memoryId: string;
  readonly previousRevisionId: string | null;
  readonly kind: MemoryKind;
  readonly content: Readonly<MemoryContent>;
  readonly evidence: readonly Readonly<EvidenceRef>[];
  readonly reason: string;
  readonly actor: Readonly<MemoryActor>;
  readonly createdAt: string;
}

export interface MemoryPrincipal {
  readonly actor: Readonly<MemoryActor>;
  readonly tenantIds: readonly string[];
}

export type MemoryAction = "read" | "write" | "delete";

type UnknownRecord = Record<string, unknown>;

const MEMORY_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const MEMORY_KINDS: readonly MemoryKind[] = [
  "preference",
  "fact",
  "decision",
  "reference",
];
const MEMORY_STATUSES: readonly MemoryStatus[] = [
  "active",
  "superseded",
  "expired",
];
const EVIDENCE_SOURCES: readonly EvidenceSource[] = [
  "user-input",
  "conversation",
  "message",
  "pull-request",
  "document",
  "engine-run",
];
const ACTOR_KINDS: readonly MemoryActor["kind"][] = [
  "user",
  "system",
  "engine",
];

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function exact(
  value: UnknownRecord,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} has unknown field "${unknown}"`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function identifier(value: unknown, label: string): string {
  const result = text(value, label);
  if (!MEMORY_ID.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label);
  if (Number.isNaN(Date.parse(result))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return result;
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : timestamp(value, label);
}

function memoryKind(value: unknown): MemoryKind {
  if (!MEMORY_KINDS.includes(value as MemoryKind)) {
    throw new Error("Memory kind is invalid");
  }
  return value as MemoryKind;
}

function memoryContent(value: unknown): Readonly<MemoryContent> {
  const input = record(value, "Memory content");
  exact(input, ["title", "summary", "body"], "Memory content");
  return Object.freeze({
    title: text(input.title, "Memory title"),
    summary: text(input.summary, "Memory summary"),
    body: text(input.body, "Memory body"),
  });
}

function memoryScope(value: unknown): MemoryScope {
  const input = record(value, "Memory scope");
  const kind = text(input.kind, "Memory scope kind");
  if (kind === "user") {
    exact(input, ["kind", "userId"], "Memory scope");
    return Object.freeze({
      kind,
      userId: text(input.userId, "Memory scope userId"),
    });
  }
  if (kind === "repository") {
    exact(input, ["kind", "tenantId"], "Memory scope");
    return Object.freeze({
      kind,
      tenantId: text(input.tenantId, "Memory scope tenantId"),
    });
  }
  throw new Error("Memory scope kind is invalid");
}

function evidenceRef(value: unknown): Readonly<EvidenceRef> {
  const input = record(value, "Memory evidence");
  exact(input, ["source", "id", "conversationId", "uri"], "Memory evidence");
  if (!EVIDENCE_SOURCES.includes(input.source as EvidenceSource)) {
    throw new Error("Memory evidence source is invalid");
  }
  return Object.freeze({
    source: input.source as EvidenceSource,
    id: text(input.id, "Memory evidence id"),
    ...(input.conversationId === undefined
      ? {}
      : {
          conversationId: text(
            input.conversationId,
            "Memory evidence conversationId",
          ),
        }),
    ...(input.uri === undefined
      ? {}
      : { uri: text(input.uri, "Memory evidence uri") }),
  });
}

function memoryActor(value: unknown): Readonly<MemoryActor> {
  const input = record(value, "Memory actor");
  exact(input, ["kind", "id"], "Memory actor");
  if (!ACTOR_KINDS.includes(input.kind as MemoryActor["kind"])) {
    throw new Error("Memory actor kind is invalid");
  }
  return Object.freeze({
    kind: input.kind as MemoryActor["kind"],
    id: text(input.id, "Memory actor id"),
  });
}

export function createMemory(value: unknown): Readonly<Memory> {
  const input = record(value, "Memory");
  exact(
    input,
    [
      "id",
      "scope",
      "kind",
      "content",
      "currentRevisionId",
      "status",
      "createdAt",
      "updatedAt",
      "expiresAt",
    ],
    "Memory",
  );
  if (!MEMORY_STATUSES.includes(input.status as MemoryStatus)) {
    throw new Error("Memory status is invalid");
  }
  const createdAt = timestamp(input.createdAt, "Memory createdAt");
  const updatedAt = timestamp(input.updatedAt, "Memory updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error("Memory updatedAt cannot be before createdAt");
  }
  const expiresAt = optionalTimestamp(input.expiresAt, "Memory expiresAt");
  return Object.freeze({
    id: identifier(input.id, "Memory id"),
    scope: memoryScope(input.scope),
    kind: memoryKind(input.kind),
    content: memoryContent(input.content),
    currentRevisionId: identifier(
      input.currentRevisionId,
      "Memory currentRevisionId",
    ),
    status: input.status as MemoryStatus,
    createdAt,
    updatedAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });
}

export function createMemoryRevision(value: unknown): Readonly<MemoryRevision> {
  const input = record(value, "Memory revision");
  exact(
    input,
    [
      "id",
      "memoryId",
      "previousRevisionId",
      "kind",
      "content",
      "evidence",
      "reason",
      "actor",
      "createdAt",
    ],
    "Memory revision",
  );
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
    throw new Error("Memory revision evidence is required");
  }
  const evidence = Object.freeze(input.evidence.map(evidenceRef));
  return Object.freeze({
    id: identifier(input.id, "Memory revision id"),
    memoryId: identifier(input.memoryId, "Memory revision memoryId"),
    previousRevisionId:
      input.previousRevisionId === null
        ? null
        : identifier(
            input.previousRevisionId,
            "Memory revision previousRevisionId",
          ),
    kind: memoryKind(input.kind),
    content: memoryContent(input.content),
    evidence,
    reason: text(input.reason, "Memory revision reason"),
    actor: memoryActor(input.actor),
    createdAt: timestamp(input.createdAt, "Memory revision createdAt"),
  });
}

export function reviseMemory(
  memory: Readonly<Memory>,
  value: unknown,
): Readonly<{
  memory: Readonly<Memory>;
  revision: Readonly<MemoryRevision>;
}> {
  if (memory.status !== "active") {
    throw new Error("Only an active memory can be revised");
  }
  const input = record(value, "Memory revision input");
  exact(
    input,
    [
      "revisionId",
      "kind",
      "content",
      "evidence",
      "reason",
      "actor",
      "createdAt",
    ],
    "Memory revision input",
  );
  const revision = createMemoryRevision({
    id: input.revisionId,
    memoryId: memory.id,
    previousRevisionId: memory.currentRevisionId,
    kind: input.kind,
    content: input.content,
    evidence: input.evidence,
    reason: input.reason,
    actor: input.actor,
    createdAt: input.createdAt,
  });
  if (Date.parse(revision.createdAt) < Date.parse(memory.updatedAt)) {
    throw new Error("Memory revision cannot be older than the current memory");
  }
  const updated = createMemory({
    ...memory,
    kind: revision.kind,
    content: revision.content,
    currentRevisionId: revision.id,
    updatedAt: revision.createdAt,
  });
  return Object.freeze({ memory: updated, revision });
}

export function canPerformMemoryAction(
  principal: Readonly<MemoryPrincipal>,
  scope: MemoryScope,
  action: MemoryAction,
): boolean {
  if (principal.actor.kind === "system") return false;
  const hasScopeAccess =
    scope.kind === "user"
      ? principal.actor.kind === "user" && scope.userId === principal.actor.id
      : principal.tenantIds.includes(scope.tenantId);
  if (!hasScopeAccess) return false;
  return action !== "delete" || principal.actor.kind === "user";
}
