export const ENGINE_EXECUTION_REQUEST_ENV = "KODY_RUN_REQUEST_JSON";

export * from "./workflow.js";
export * from "./strategy.js";

export type EngineExecutionTarget =
  | { type: "chat"; id: string }
  | { type: "issue"; id: number }
  | { type: "goal"; id: string }
  | { type: "workflow"; id: string }
  | { type: "loop"; id: string };

export type EngineExecutionIntent = "continue" | "manage" | "run" | "tick";
export type EngineExecutionSource = "dashboard" | "github" | "schedule";

export interface EngineExecutionRequest {
  requestId: string;
  target: EngineExecutionTarget;
  intent: EngineExecutionIntent;
  source: EngineExecutionSource;
  input?: Record<string, unknown>;
}

export interface EngineExecutionReceipt {
  requestId: string;
  acceptedAt: string;
}

export type EngineExecutionRequestParseResult =
  { request: EngineExecutionRequest } | { error: string };

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const INTENTS = new Set<EngineExecutionIntent>([
  "continue",
  "manage",
  "run",
  "tick",
]);
const SOURCES = new Set<EngineExecutionSource>([
  "dashboard",
  "github",
  "schedule",
]);
const TARGET_TYPES = new Set<EngineExecutionTarget["type"]>([
  "chat",
  "issue",
  "goal",
  "workflow",
  "loop",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseTarget(
  value: unknown,
): { target: EngineExecutionTarget } | { error: string } {
  if (!isRecord(value)) {
    return { error: "request.target must be an object" };
  }
  const type = normalizedString(value.type) as EngineExecutionTarget["type"];
  if (!TARGET_TYPES.has(type)) {
    return { error: "request.target.type is invalid" };
  }
  if (type === "issue") {
    const id = Number(value.id);
    return Number.isInteger(id) && id > 0
      ? { target: { type, id } }
      : { error: "request.target.id must be a positive issue number" };
  }
  const id = normalizedString(value.id);
  return id
    ? { target: { type, id } as EngineExecutionTarget }
    : { error: "request.target.id is required" };
}

export function parseEngineExecutionRequest(
  value: unknown,
): EngineExecutionRequestParseResult {
  let body = value;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return { error: "request is empty" };
    try {
      body = JSON.parse(raw);
    } catch {
      return { error: "request must be valid JSON" };
    }
  }
  if (!isRecord(body)) return { error: "request must be an object" };

  const requestId = normalizedString(body.requestId);
  if (!IDENTIFIER.test(requestId)) {
    return { error: "request.requestId is invalid" };
  }
  const parsedTarget = parseTarget(body.target);
  if ("error" in parsedTarget) return parsedTarget;

  const intent = normalizedString(body.intent) as EngineExecutionIntent;
  if (!INTENTS.has(intent)) return { error: "request.intent is invalid" };

  const source = normalizedString(body.source) as EngineExecutionSource;
  if (!SOURCES.has(source)) return { error: "request.source is invalid" };

  if (body.input !== undefined && !isRecord(body.input)) {
    return { error: "request.input must be an object when provided" };
  }

  return {
    request: {
      requestId,
      target: parsedTarget.target,
      intent,
      source,
      ...(body.input !== undefined ? { input: body.input } : {}),
    },
  };
}
