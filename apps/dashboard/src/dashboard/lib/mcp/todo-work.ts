import type { TodoFile, TodoItemFile } from "@kody-ade/workspace/todos/files";

export type WorkStatus =
  "planned" | "active" | "blocked" | "completed" | "cancelled";

export type WorkActor = {
  tokenId: string;
  name: string;
  actorLogin: string;
};

type WorkRequest = { key: string; hash: string };
type WorkEventType =
  "checkpoint" | "evidence" | "decision" | "handoff" | "artifact";
type WorkEvent = {
  type: WorkEventType;
  payload: Record<string, unknown>;
  actor: WorkActor;
  recordedAt: string;
  seq: number;
};
type WorkMeta = {
  version: 1;
  status: WorkStatus;
  revision: number;
  summary: string;
  goal?: string;
  blockers: string[];
  updatedBy: WorkActor;
  requests: WorkRequest[];
};

export class TodoWorkError extends Error {
  constructor(
    public readonly code: "conflict" | "invalid_work",
    message: string,
  ) {
    super(message);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function workMeta(todo: TodoFile): WorkMeta {
  const raw = asRecord(todo.frontmatter?.mcpWork);
  const actor = asRecord(raw?.updatedBy);
  if (
    raw?.version !== 1 ||
    typeof raw.revision !== "number" ||
    !actor ||
    typeof actor.tokenId !== "string" ||
    typeof actor.name !== "string" ||
    typeof actor.actorLogin !== "string"
  ) {
    throw new TodoWorkError("invalid_work", "Todo is not MCP-managed work.");
  }
  return {
    version: 1,
    status: isWorkStatus(raw.status) ? raw.status : "planned",
    revision: raw.revision,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    ...(typeof raw.goal === "string" ? { goal: raw.goal } : {}),
    blockers: Array.isArray(raw.blockers)
      ? raw.blockers.filter((item): item is string => typeof item === "string")
      : [],
    updatedBy: {
      tokenId: actor.tokenId,
      name: actor.name,
      actorLogin: actor.actorLogin,
    },
    requests: Array.isArray(raw.requests)
      ? raw.requests.flatMap((value) => {
          const request = asRecord(value);
          return request &&
            typeof request.key === "string" &&
            typeof request.hash === "string"
            ? [{ key: request.key, hash: request.hash }]
            : [];
        })
      : [],
  };
}

function isWorkStatus(value: unknown): value is WorkStatus {
  return ["planned", "active", "blocked", "completed", "cancelled"].includes(
    String(value),
  );
}

function eventFromItem(item: TodoItemFile): WorkEvent | null {
  const raw = asRecord(item.meta?.mcpWorkEvent);
  const actor = asRecord(raw?.actor);
  if (
    !raw ||
    !["checkpoint", "evidence", "decision", "handoff", "artifact"].includes(
      String(raw.type),
    ) ||
    !asRecord(raw.payload) ||
    !actor ||
    typeof actor.tokenId !== "string" ||
    typeof actor.name !== "string" ||
    typeof actor.actorLogin !== "string" ||
    typeof raw.recordedAt !== "string" ||
    typeof raw.seq !== "number"
  )
    return null;
  return {
    type: raw.type as WorkEventType,
    payload: raw.payload as Record<string, unknown>,
    actor: {
      tokenId: actor.tokenId,
      name: actor.name,
      actorLogin: actor.actorLogin,
    },
    recordedAt: raw.recordedAt,
    seq: raw.seq,
  };
}

function requestState(meta: WorkMeta, request: WorkRequest): "new" | "replay" {
  const existing = meta.requests.find((item) => item.key === request.key);
  if (!existing) return "new";
  if (existing.hash === request.hash) return "replay";
  throw new TodoWorkError(
    "conflict",
    "Idempotency key was already used with different input.",
  );
}

function nextMeta(
  current: WorkMeta,
  actor: WorkActor,
  request: WorkRequest,
  patch: Partial<Pick<WorkMeta, "status" | "summary" | "goal" | "blockers">>,
): WorkMeta {
  return {
    ...current,
    ...patch,
    revision: current.revision + 1,
    updatedBy: actor,
    requests: [...current.requests, request].slice(-100),
  };
}

function withMeta(todo: TodoFile, meta: WorkMeta, now: string): TodoFile {
  return {
    ...todo,
    updatedAt: now,
    frontmatter: { ...todo.frontmatter, mcpWork: meta },
  };
}

function taskItems(tasks: unknown, now: string): TodoItemFile[] {
  return Array.isArray(tasks)
    ? tasks.map((title, index) => ({
        id: `mcp-task-${index + 1}`,
        title: String(title),
        body: "",
        assignee: null,
        completed: false,
        createdAt: now,
        completedAt: null,
      }))
    : [];
}

export function createTodoWork(
  input: Record<string, unknown>,
  actor: WorkActor,
  request: WorkRequest,
  now: string,
): TodoFile {
  const slug = String(input.recordId);
  const meta: WorkMeta = {
    version: 1,
    status: isWorkStatus(input.status) ? input.status : "planned",
    revision: 1,
    summary: typeof input.summary === "string" ? input.summary : "",
    ...(typeof input.goal === "string" ? { goal: input.goal } : {}),
    blockers: [],
    updatedBy: actor,
    requests: [request],
  };
  return {
    slug,
    path: `todos/${slug}.json`,
    sha: "",
    htmlUrl: "",
    title: String(input.title).slice(0, 160),
    description: String(input.objective),
    items: taskItems(input.tasks, now),
    createdAt: now,
    updatedAt: now,
    frontmatter: { mcpWork: meta },
  };
}

export function updateTodoWork(
  todo: TodoFile,
  input: Record<string, unknown>,
  actor: WorkActor,
  request: WorkRequest,
  now: string,
): TodoFile {
  const meta = workMeta(todo);
  if (requestState(meta, request) === "replay") return todo;
  if (meta.revision !== input.expectedRevision)
    throw new TodoWorkError("conflict", "Work revision changed.");
  const events = todo.items.filter((item) => eventFromItem(item));
  return withMeta(
    {
      ...todo,
      ...(typeof input.title === "string"
        ? { title: input.title.slice(0, 160) }
        : {}),
      ...(typeof input.objective === "string"
        ? { description: input.objective }
        : {}),
      ...(Array.isArray(input.tasks)
        ? { items: [...taskItems(input.tasks, now), ...events] }
        : {}),
    },
    nextMeta(meta, actor, request, {
      ...(isWorkStatus(input.status) ? { status: input.status } : {}),
      ...(typeof input.summary === "string" ? { summary: input.summary } : {}),
      ...(typeof input.goal === "string" ? { goal: input.goal } : {}),
      ...(Array.isArray(input.blockers)
        ? { blockers: input.blockers.map(String) }
        : {}),
    }),
    now,
  );
}

function eventPresentation(
  type: WorkEventType,
  payload: Record<string, unknown>,
) {
  const summary = String(payload.summary ?? type);
  if (type === "decision")
    return {
      title: `Decision: ${summary}`,
      body: String(payload.rationale ?? ""),
    };
  if (type === "evidence" || type === "artifact")
    return {
      title: `${type === "evidence" ? "Evidence" : "Artifact"}: ${summary}`,
      body: [payload.kind, payload.reference].filter(Boolean).join(" · "),
    };
  if (type === "handoff")
    return {
      title: `Handoff to ${String(payload.toAgent)}: ${summary}`,
      body: Array.isArray(payload.nextSteps)
        ? payload.nextSteps.map((step) => `- ${String(step)}`).join("\n")
        : "",
    };
  return { title: `Checkpoint: ${summary}`, body: "" };
}

export function appendTodoWork(
  todo: TodoFile,
  type: WorkEventType,
  payload: Record<string, unknown>,
  expectedRevision: number,
  actor: WorkActor,
  request: WorkRequest,
  now: string,
): TodoFile {
  const meta = workMeta(todo);
  if (requestState(meta, request) === "replay") return todo;
  if (meta.revision !== expectedRevision)
    throw new TodoWorkError("conflict", "Work revision changed.");
  const seq = meta.revision;
  const event: WorkEvent = { type, payload, actor, recordedAt: now, seq };
  const presentation = eventPresentation(type, payload);
  return withMeta(
    {
      ...todo,
      items: [
        ...todo.items,
        {
          id: `mcp-event-${seq}`,
          ...presentation,
          assignee: type === "handoff" ? String(payload.toAgent) : null,
          completed: type !== "handoff",
          createdAt: now,
          completedAt: type !== "handoff" ? now : null,
          meta: { mcpWorkEvent: event },
        },
      ],
    },
    nextMeta(meta, actor, request, {}),
    now,
  );
}

export function readTodoWork(todo: TodoFile, repository = "") {
  const meta = workMeta(todo);
  const events = todo.items.flatMap((item) => {
    const event = eventFromItem(item);
    return event ? [event] : [];
  });
  const selected = (type: WorkEventType) =>
    events
      .filter((event) => event.type === type)
      .map((event) => ({
        ...event.payload,
        actor: event.actor,
        recordedAt: event.recordedAt,
      }));
  const handoffs = selected("handoff");
  return {
    record: {
      recordId: todo.slug,
      repository,
      title: todo.title,
      objective: todo.description,
      status: meta.status,
      revision: meta.revision,
      summary: meta.summary,
      ...(meta.goal ? { goal: meta.goal } : {}),
      tasks: todo.items
        .filter((item) => !eventFromItem(item))
        .map((item) => item.title),
      blockers: meta.blockers,
      updatedBy: meta.updatedBy,
      decisions: selected("decision"),
      checkpoints: selected("checkpoint"),
      evidence: selected("evidence"),
      artifacts: selected("artifact"),
      ...(handoffs.length > 0 ? { handoff: handoffs.at(-1) } : {}),
      createdAt: todo.createdAt,
      updatedAt: todo.updatedAt,
    },
    events: events.map((event) => ({
      seq: event.seq,
      type: event.type,
      payload: event.payload,
      actor: event.actor,
      occurredAt: event.recordedAt,
    })),
  };
}

export function workRequestState(
  todo: TodoFile,
  request: WorkRequest,
): "new" | "replay" {
  return requestState(workMeta(todo), request);
}
