/**
 * @fileType utility
 * @domain triggers
 * @pattern trigger-engine
 * @ai-summary Pure trigger evaluation: does an event envelope match a
 *   trigger's event name + conditions, and what data does its action map
 *   extract. No I/O — the sink wires this to storage.
 */
import type { SystemEventEnvelope } from "../events/types";
import type { TriggerCondition, TriggerConfig } from "./types";

function payloadValue(
  payload: Record<string, unknown>,
  path: string,
): unknown {
  let current: unknown = payload;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function conditionMatches(
  condition: TriggerCondition,
  payload: Record<string, unknown>,
): boolean {
  const actual = payloadValue(payload, condition.path);
  switch (condition.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "equals":
      return actual === condition.value;
    case "not_equals":
      return actual !== condition.value;
    case "contains":
      if (typeof actual === "string" && typeof condition.value === "string") {
        return actual.includes(condition.value);
      }
      if (Array.isArray(actual)) return actual.includes(condition.value);
      return false;
  }
}

export function triggerMatches(
  trigger: TriggerConfig,
  event: SystemEventEnvelope,
): boolean {
  if (!trigger.enabled) return false;
  if (trigger.event !== event.name) return false;
  return trigger.conditions.every((condition) =>
    conditionMatches(condition, event.payload),
  );
}

/**
 * Resolve the action map against the event. Sources: `payload.<path>`,
 * `event.name`, `event.occurredAt`, `event.sessionId`, `literal:<value>`.
 * Unresolvable payload paths are skipped (never write `undefined`).
 * An empty map saves the whole event payload as-is.
 */
export function resolveActionData(
  trigger: TriggerConfig,
  event: SystemEventEnvelope,
): Record<string, unknown> {
  const map =
    trigger.action.type === "save-user-state"
      ? trigger.action.map
      : trigger.action.inputMap;
  if (Object.keys(map).length === 0) {
    return { ...event.payload };
  }
  const data: Record<string, unknown> = {};
  for (const [targetKey, source] of Object.entries(map)) {
    let value: unknown;
    if (source.startsWith("payload.")) {
      value = payloadValue(event.payload, source.slice("payload.".length));
    } else if (source.startsWith("literal:")) {
      value = source.slice("literal:".length);
    } else if (source === "event.name") {
      value = event.name;
    } else if (source === "event.occurredAt") {
      value = event.occurredAt;
    } else if (source === "event.sessionId") {
      value = event.sessionId;
    }
    if (value !== undefined && value !== null) {
      data[targetKey] = value;
    }
  }
  return data;
}
