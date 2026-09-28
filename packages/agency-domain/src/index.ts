export type ReferenceKind =
  "todo" | "loop" | "workflow" | "capability" | "pipeline" | "agent";

export interface DefinitionRef {
  kind: ReferenceKind;
  id: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  instructions: string;
  permissions: string[];
}

export interface AgentState {
  version: 1;
  agent: string;
  revision: number;
  cursor: string;
  summary: string;
  data: Readonly<Record<string, unknown>>;
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  capabilityRef: DefinitionRef & { kind: "capability" };
  dependsOn: string[];
  input?: Readonly<Record<string, unknown>>;
  condition?: string;
  retry?: { maxAttempts: number; backoffSeconds: number };
}

export interface WorkflowDefinition {
  id: string;
  agent: string;
  steps: WorkflowStep[];
}

export type TodoStatus = "todo" | "in-progress" | "blocked" | "done";

export type AgencyRequestPhase =
  | "assessing"
  | "waiting-information"
  | "waiting-approval"
  | "running"
  | "monitoring"
  | "done"
  | "blocked";

export type AgencyRequestSource =
  | {
      kind: "guided-flow";
      instanceId: string;
      effectId: string;
      flowId?: string;
    }
  | {
      kind: "store-blueprint";
      blueprintId: string;
      requestId: string;
    };

export interface AgencyRequirement {
  outcome: string;
  activation?: string;
  permissions?: string;
  success?: string;
  context?: string;
}

export interface AgencyRequestRelatedRef {
  kind:
    | "strategy"
    | "solution"
    | "trigger"
    | "loop"
    | "workflow"
    | "capability"
    | "run"
    | "report";
  id: string;
}

export type AgencyActivationKind =
  | Exclude<AgencyRequestRelatedRef["kind"], "strategy" | "run" | "report">
  | "agent"
  | "pipeline";

export interface AgencyRequestExecution {
  workflowId: string;
  input: Readonly<Record<string, unknown>>;
  activations?: ReadonlyArray<{ kind: AgencyActivationKind; id: string }>;
}

export interface AgencyRequestState {
  phase: AgencyRequestPhase;
  source: AgencyRequestSource;
  requirement: AgencyRequirement;
  questions: string[];
  plan: string[];
  execution?: AgencyRequestExecution;
  evidence: string[];
  blockers: string[];
  related: AgencyRequestRelatedRef[];
}

export interface TodoChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Todo {
  id: string;
  outcome: string;
  status: TodoStatus;
  evidence: string[];
  checklist: TodoChecklistItem[];
  blockers: string[];
  runIds: string[];
}

export type Trigger =
  | { type: "manual" }
  | { type: "schedule"; every: string; at?: { time: string; timezone: string } }
  | { type: "event"; event: string }
  | { type: "webhook"; event: string }
  | { type: "condition"; expression: string };

export interface LoopDefinition {
  id: string;
  trigger: Trigger;
  target: DefinitionRef & {
    kind: "workflow" | "capability" | "pipeline" | "agent";
  };
  input: Readonly<Record<string, unknown>>;
  enabled: boolean;
}

export function nextLoopRunAt(
  schedule: Extract<Trigger, { type: "schedule" }>,
  after: Date,
): string {
  const match = /^(\d+)([mhd])$/.exec(schedule.every);
  if (!match || Number(match[1]) < 1) {
    throw new Error("Loop schedule cadence is invalid");
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (!schedule.at) {
    const intervalMs =
      amount * (unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000);
    return new Date(
      (Math.floor(after.getTime() / intervalMs) + 1) * intervalMs,
    ).toISOString();
  }
  if (
    schedule.every !== "1d" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.at.time)
  ) {
    throw new Error("Preferred time requires a daily schedule and HH:MM time");
  }
  const local = zonedParts(after, schedule.at.timezone);
  const [hour, minute] = schedule.at.time.split(":").map(Number);
  const currentMinute = local.hour * 60 + local.minute;
  const targetMinute = hour * 60 + minute;
  const localDate = new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day + (currentMinute >= targetMinute ? 1 : 0),
    ),
  );
  return zonedLocalToUtc(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth() + 1,
    localDate.getUTCDate(),
    hour,
    minute,
    schedule.at.timezone,
  ).toISOString();
}

function zonedParts(date: Date, timezone: string) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(values.find((value) => value.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rendered = zonedParts(new Date(candidate), timezone);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
    );
    candidate += desired - renderedAsUtc;
  }
  return new Date(candidate);
}

export interface Run {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  target: DefinitionRef & { kind: "workflow" | "capability" };
  agent: string;
  todoId?: string;
  parentRunId?: string;
  startedAt: string;
  finishedAt?: string;
  output?: unknown;
  error?: string;
}

export interface DomainRelationship {
  owner: DefinitionRef;
  field: string;
  target: DefinitionRef;
}

type UnknownRecord = Record<string, unknown>;
const ID = /^[a-z][a-z0-9-]{0,127}$/;

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
  if (!ID.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label);
  if (Number.isNaN(Date.parse(result))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return result;
}

function strings(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function jsonObject(value: unknown, label: string): Readonly<UnknownRecord> {
  return Object.freeze({ ...record(value, label) });
}

function reference(
  value: unknown,
  kinds: readonly ReferenceKind[],
  label: string,
): DefinitionRef {
  const input = record(value, label);
  exact(input, ["kind", "id"], label);
  if (
    typeof input.kind !== "string" ||
    !kinds.includes(input.kind as ReferenceKind)
  ) {
    throw new Error(`${label}.kind is invalid`);
  }
  return Object.freeze({
    kind: input.kind as ReferenceKind,
    id: identifier(input.id, `${label}.id`),
  });
}

export function createAgentDefinition(value: unknown): AgentDefinition {
  const input = record(value, "Agent");
  exact(input, ["id", "name", "instructions", "permissions"], "Agent");
  return Object.freeze({
    id: identifier(input.id, "Agent id"),
    name: text(input.name, "Agent name"),
    instructions: text(input.instructions, "Agent instructions"),
    permissions: strings(input.permissions, "Agent permissions"),
  });
}

export function createAgentState(value: unknown): AgentState {
  const input = record(value, "AgentState");
  exact(
    input,
    ["version", "agent", "revision", "cursor", "summary", "data", "updatedAt"],
    "AgentState",
  );
  if (input.version !== 1) throw new Error("AgentState version must be 1");
  if (!Number.isInteger(input.revision) || Number(input.revision) < 0) {
    throw new Error("AgentState revision must be a non-negative integer");
  }
  if (typeof input.cursor !== "string") {
    throw new Error("AgentState cursor must be a string");
  }
  if (typeof input.summary !== "string") {
    throw new Error("AgentState summary must be a string");
  }
  return Object.freeze({
    version: 1,
    agent: identifier(input.agent, "AgentState agent"),
    revision: Number(input.revision),
    cursor: input.cursor,
    summary: input.summary,
    data: jsonObject(input.data, "AgentState data"),
    updatedAt: timestamp(input.updatedAt, "AgentState updatedAt"),
  });
}

export function createWorkflowDefinition(value: unknown): WorkflowDefinition {
  const input = record(value, "Workflow");
  exact(input, ["id", "agent", "steps"], "Workflow");
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error("Workflow steps are required");
  }
  const steps = input.steps.map((value) => {
    const step = record(value, "Workflow step");
    exact(
      step,
      ["id", "capabilityRef", "dependsOn", "input", "condition", "retry"],
      "Workflow step",
    );
    const retry =
      step.retry === undefined ? undefined : record(step.retry, "Step retry");
    if (retry) {
      exact(retry, ["maxAttempts", "backoffSeconds"], "Step retry");
      if (
        !Number.isInteger(retry.maxAttempts) ||
        Number(retry.maxAttempts) < 1 ||
        typeof retry.backoffSeconds !== "number" ||
        retry.backoffSeconds < 0
      ) {
        throw new Error("Step retry is invalid");
      }
    }
    return Object.freeze({
      id: identifier(step.id, "Workflow step id"),
      capabilityRef: reference(
        step.capabilityRef,
        ["capability"],
        "Workflow step capability",
      ) as WorkflowStep["capabilityRef"],
      dependsOn:
        step.dependsOn === undefined
          ? []
          : strings(step.dependsOn, "Workflow step dependencies"),
      ...(step.input === undefined
        ? {}
        : { input: jsonObject(step.input, "Workflow step input") }),
      ...(step.condition === undefined
        ? {}
        : { condition: text(step.condition, "Workflow step condition") }),
      ...(retry
        ? {
            retry: {
              maxAttempts: Number(retry.maxAttempts),
              backoffSeconds: retry.backoffSeconds as number,
            },
          }
        : {}),
    });
  });
  const ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length)
    throw new Error("Workflow step ids must be unique");
  for (const step of steps) {
    const missing = step.dependsOn.find((dependency) => !ids.has(dependency));
    if (missing) {
      throw new Error(
        `Workflow step "${step.id}" has missing dependency "${missing}"`,
      );
    }
  }
  return Object.freeze({
    id: identifier(input.id, "Workflow id"),
    agent: identifier(input.agent, "Workflow agent"),
    steps,
  });
}

export function createTodo(value: unknown): Todo {
  const input = record(value, "Todo");
  exact(
    input,
    ["id", "outcome", "status", "evidence", "checklist", "blockers", "runIds"],
    "Todo",
  );
  const statuses: TodoStatus[] = ["todo", "in-progress", "blocked", "done"];
  if (!statuses.includes(input.status as TodoStatus)) {
    throw new Error("Todo status is invalid");
  }
  return Object.freeze({
    id: identifier(input.id, "Todo id"),
    outcome: text(input.outcome, "Todo outcome"),
    status: input.status as TodoStatus,
    evidence: strings(input.evidence, "Todo evidence"),
    checklist: (() => {
      if (!Array.isArray(input.checklist)) {
        throw new Error("Todo checklist must be an array");
      }
      return input.checklist.map((value) => {
        const item = record(value, "Todo checklist item");
        exact(item, ["id", "text", "done"], "Todo checklist item");
        if (typeof item.done !== "boolean") {
          throw new Error("Todo checklist item done must be a boolean");
        }
        return Object.freeze({
          id: identifier(item.id, "Todo checklist item id"),
          text: text(item.text, "Todo checklist item text"),
          done: item.done,
        });
      });
    })(),
    blockers: strings(input.blockers, "Todo blockers"),
    runIds: strings(input.runIds, "Todo runIds"),
  });
}

export function createAgencyRequestState(value: unknown): AgencyRequestState {
  const input = record(value, "Agency request");
  exact(
    input,
    [
      "phase",
      "source",
      "requirement",
      "questions",
      "plan",
      "execution",
      "evidence",
      "blockers",
      "related",
    ],
    "Agency request",
  );
  const phases: AgencyRequestPhase[] = [
    "assessing",
    "waiting-information",
    "waiting-approval",
    "running",
    "monitoring",
    "done",
    "blocked",
  ];
  if (!phases.includes(input.phase as AgencyRequestPhase)) {
    throw new Error("Agency request phase is invalid");
  }

  const source = record(input.source, "Agency request source");
  if (source.kind === "guided-flow") {
    exact(
      source,
      ["kind", "instanceId", "effectId", "flowId"],
      "Agency request source",
    );
  } else if (source.kind === "store-blueprint") {
    exact(
      source,
      ["kind", "blueprintId", "requestId"],
      "Agency request source",
    );
  } else {
    throw new Error("Agency request source kind is invalid");
  }

  const requirement = record(input.requirement, "Agency request requirement");
  exact(
    requirement,
    ["outcome", "activation", "permissions", "success", "context"],
    "Agency request requirement",
  );
  const optionalText = (key: string) =>
    requirement[key] === undefined
      ? {}
      : { [key]: text(requirement[key], `Agency request ${key}`) };

  if (!Array.isArray(input.related)) {
    throw new Error("Agency request related must be an array");
  }
  const execution =
    input.execution === undefined
      ? undefined
      : record(input.execution, "Agency request execution");
  if (execution) {
    exact(
      execution,
      ["workflowId", "input", "activations"],
      "Agency request execution",
    );
  }
  const relatedKinds: AgencyRequestRelatedRef["kind"][] = [
    "strategy",
    "solution",
    "trigger",
    "loop",
    "workflow",
    "capability",
    "run",
    "report",
  ];

  return Object.freeze({
    phase: input.phase as AgencyRequestPhase,
    source: Object.freeze(
      source.kind === "guided-flow"
        ? {
            kind: "guided-flow" as const,
            instanceId: text(
              source.instanceId,
              "Agency request source instanceId",
            ),
            effectId: text(source.effectId, "Agency request source effectId"),
            ...(source.flowId === undefined
              ? {}
              : {
                  flowId: identifier(
                    source.flowId,
                    "Agency request source flowId",
                  ),
                }),
          }
        : {
            kind: "store-blueprint" as const,
            blueprintId: identifier(
              source.blueprintId,
              "Agency request source blueprintId",
            ),
            requestId: text(
              source.requestId,
              "Agency request source requestId",
            ),
          },
    ),
    requirement: Object.freeze({
      outcome: text(requirement.outcome, "Agency request outcome"),
      ...optionalText("activation"),
      ...optionalText("permissions"),
      ...optionalText("success"),
      ...optionalText("context"),
    }),
    questions: strings(input.questions, "Agency request questions"),
    plan: strings(input.plan, "Agency request plan"),
    ...(execution
      ? {
          execution: Object.freeze({
            workflowId: identifier(
              execution.workflowId,
              "Agency request execution workflowId",
            ),
            input: jsonObject(
              execution.input,
              "Agency request execution input",
            ),
            ...(execution.activations === undefined
              ? {}
              : { activations: parseAgencyActivations(execution.activations) }),
          }),
        }
      : {}),
    evidence:
      input.evidence === undefined
        ? []
        : strings(input.evidence, "Agency request evidence"),
    blockers:
      input.blockers === undefined
        ? []
        : strings(input.blockers, "Agency request blockers"),
    related: input.related.map((value) => {
      const related = record(value, "Agency request related reference");
      exact(related, ["kind", "id"], "Agency request related reference");
      if (
        !relatedKinds.includes(related.kind as AgencyRequestRelatedRef["kind"])
      ) {
        throw new Error("Agency request related reference kind is invalid");
      }
      return Object.freeze({
        kind: related.kind as AgencyRequestRelatedRef["kind"],
        id: text(related.id, "Agency request related reference id"),
      });
    }),
  });
}

function parseAgencyActivations(
  value: unknown,
): ReadonlyArray<{ kind: AgencyActivationKind; id: string }> {
  if (!Array.isArray(value)) {
    throw new Error("Agency request execution activations must be an array");
  }
  const kinds: AgencyActivationKind[] = [
    "solution",
    "trigger",
    "loop",
    "pipeline",
    "workflow",
    "capability",
    "agent",
  ];
  return value.map((entry) => {
    const activation = record(entry, "Agency request activation");
    exact(activation, ["kind", "id"], "Agency request activation");
    if (!kinds.includes(activation.kind as AgencyActivationKind)) {
      throw new Error("Agency request activation kind is invalid");
    }
    return Object.freeze({
      kind: activation.kind as AgencyActivationKind,
      id: identifier(activation.id, "Agency request activation id"),
    });
  });
}

function trigger(value: unknown): Trigger {
  const input = record(value, "Loop trigger");
  const type = text(input.type, "Loop trigger type");
  if (type === "manual") {
    exact(input, ["type"], "Loop trigger");
    return Object.freeze({ type });
  }
  if (type === "schedule") {
    exact(input, ["type", "every", "at"], "Loop trigger");
    if (input.at === undefined) {
      return Object.freeze({
        type,
        every: text(input.every, "Loop trigger every"),
      });
    }
    const at = record(input.at, "Loop trigger at");
    exact(at, ["time", "timezone"], "Loop trigger at");
    return Object.freeze({
      type,
      every: text(input.every, "Loop trigger every"),
      at: {
        time: text(at.time, "Loop trigger time"),
        timezone: text(at.timezone, "Loop trigger timezone"),
      },
    });
  }
  if (type === "event" || type === "webhook") {
    exact(input, ["type", "event"], "Loop trigger");
    return Object.freeze({
      type,
      event: text(input.event, "Loop trigger event"),
    });
  }
  if (type === "condition") {
    exact(input, ["type", "expression"], "Loop trigger");
    return Object.freeze({
      type,
      expression: text(input.expression, "Loop trigger expression"),
    });
  }
  throw new Error("Loop trigger type is invalid");
}

export function createLoopDefinition(value: unknown): LoopDefinition {
  const input = record(value, "Loop");
  exact(input, ["id", "trigger", "target", "input", "enabled"], "Loop");
  if (typeof input.enabled !== "boolean") {
    throw new Error("Loop enabled must be a boolean");
  }
  return Object.freeze({
    id: identifier(input.id, "Loop id"),
    trigger: trigger(input.trigger),
    target: reference(
      input.target,
      ["workflow", "capability", "pipeline", "agent"],
      "Loop target",
    ) as LoopDefinition["target"],
    input: jsonObject(input.input, "Loop input"),
    enabled: input.enabled,
  });
}

export function createRun(value: unknown): Run {
  const input = record(value, "Run");
  exact(
    input,
    [
      "id",
      "status",
      "target",
      "agent",
      "todoId",
      "parentRunId",
      "startedAt",
      "finishedAt",
      "output",
      "error",
    ],
    "Run",
  );
  const statuses: Run["status"][] = [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
  ];
  if (!statuses.includes(input.status as Run["status"])) {
    throw new Error("Run status is invalid");
  }
  const run: Run = {
    id: identifier(input.id, "Run id"),
    status: input.status as Run["status"],
    target: reference(
      input.target,
      ["workflow", "capability"],
      "Run target",
    ) as Run["target"],
    agent: identifier(input.agent, "Run agent"),
    ...(input.todoId === undefined
      ? {}
      : { todoId: identifier(input.todoId, "Run todoId") }),
    ...(input.parentRunId === undefined
      ? {}
      : { parentRunId: identifier(input.parentRunId, "Run parentRunId") }),
    startedAt: timestamp(input.startedAt, "Run startedAt"),
    ...(input.finishedAt === undefined
      ? {}
      : { finishedAt: timestamp(input.finishedAt, "Run finishedAt") }),
    ...(input.output === undefined ? {} : { output: input.output }),
    ...(input.error === undefined
      ? {}
      : { error: text(input.error, "Run error") }),
  };
  return Object.freeze(run);
}

export function deletionIssues(
  target: DefinitionRef,
  relationships: readonly DomainRelationship[],
): string[] {
  return relationships
    .filter(
      (relationship) =>
        relationship.target.kind === target.kind &&
        relationship.target.id === target.id,
    )
    .map((relationship) => {
      const owner = `${relationship.owner.kind[0]!.toUpperCase()}${relationship.owner.kind.slice(1)}`;
      return `Referenced by ${owner} "${relationship.owner.id}" through ${relationship.field}`;
    });
}
