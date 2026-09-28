import type { RenderedViewDirective } from "../chat-ui-actions";
import { getBuiltinViewRendererDefinition } from "../view-renderers/builtin";
import { buildRenderedViewDirective } from "../view-renderers/template";
import type {
  GuidedFlowCommandStepDefinition,
  GuidedFlowDefinition,
  GuidedFlowInstance,
} from "./model";
import { guidedFlowStepResult } from "./step-results";

const COMMAND_RESULT_FIELDS = new Set([
  "actionId",
  "approvalChallenge",
  "approvalExpiresAt",
  "runId",
  "status",
  "stepResults",
  "summary",
  "workflowId",
  "workflowInput",
]);

const SENSITIVE_FIELD = /password|secret|token|credential/i;

function displayValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function displayFieldName(field: string): string {
  const withoutStorageSuffix = field.replace(/(?:Id|Path)$/, "");
  const words = withoutStorageSuffix
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) =>
      ["api", "id", "pdf", "pr", "url"].includes(word)
        ? word.toUpperCase()
        : word,
    );
  if (words.length === 0) return field;
  words[0] = `${words[0]!.charAt(0).toUpperCase()}${words[0]!.slice(1)}`;
  return words.join(" ");
}

function reviewItems(
  data: Readonly<Record<string, unknown>>,
): Array<{ label: string; value: string }> {
  return Object.entries(data).flatMap(([field, rawValue]) => {
    if (COMMAND_RESULT_FIELDS.has(field) || SENSITIVE_FIELD.test(field))
      return [];

    const labelBase = field.endsWith("Label") ? field.slice(0, -5) : null;
    const nameBase = field.endsWith("Name") ? field.slice(0, -4) : null;
    const companionBase =
      labelBase && Object.prototype.hasOwnProperty.call(data, labelBase)
        ? labelBase
        : nameBase && Object.prototype.hasOwnProperty.call(data, nameBase)
          ? nameBase
          : null;
    if (
      !companionBase &&
      (Object.prototype.hasOwnProperty.call(data, `${field}Label`) ||
        Object.prototype.hasOwnProperty.call(data, `${field}Name`))
    ) {
      return [];
    }

    const value = displayValue(rawValue);
    if (value === null) return [];
    return [
      {
        label: displayFieldName(companionBase ?? field),
        value: value.slice(0, 200),
      },
    ];
  });
}

function collectedStepData(
  definition: GuidedFlowDefinition,
  instance: GuidedFlowInstance,
  currentStepId: string,
): Readonly<Record<string, unknown>> {
  const recordedResults = instance.data.stepResults;
  if (
    !recordedResults ||
    typeof recordedResults !== "object" ||
    Array.isArray(recordedResults)
  ) {
    return instance.data;
  }

  const collected: Record<string, unknown> = {};
  for (const collectedStep of definition.steps) {
    if (collectedStep.id === currentStepId) break;
    const recorded = (recordedResults as Readonly<Record<string, unknown>>)[
      `${definition.id}@${definition.version}/${collectedStep.id}`
    ];
    if (!recorded || typeof recorded !== "object" || Array.isArray(recorded)) {
      continue;
    }
    const result = (recorded as { readonly result?: unknown }).result;
    if (!result || typeof result !== "object" || Array.isArray(result))
      continue;
    Object.assign(collected, result);
  }
  return Object.keys(collected).length > 0 ? collected : instance.data;
}

export function buildGuidedFlowCommandView(
  definition: GuidedFlowDefinition,
  instance: GuidedFlowInstance,
  step: GuidedFlowCommandStepDefinition,
): RenderedViewDirective {
  const renderer = getBuiltinViewRendererDefinition("guided-flow-command");
  if (!renderer) throw new Error("GuidedFlow command renderer not found");
  const result = guidedFlowStepResult(definition, instance, step.id);
  const completed = result?.status === "completed";
  const running = result?.status === "running";
  const needsAttention = result?.status === "needs_attention";
  const review = reviewItems(collectedStepData(definition, instance, step.id));
  const hasApprovalChallenge =
    needsAttention && typeof result?.approvalChallenge === "string";
  const view = buildRenderedViewDirective({
    id: `guided-flow-${instance.instanceId}-${instance.revision}`,
    definition: renderer,
    data: {
      title: step.title,
      body: step.explanation,
      command: step.command,
      reviewTitle: review.length > 0 ? "Review before running" : "",
      review,
      status: completed
        ? "completed"
        : running
          ? "running"
          : needsAttention
            ? "needs_attention"
            : "ready",
      summary:
        typeof result?.summary === "string"
          ? result.summary
          : completed
            ? "Command completed."
            : running
              ? "Workflow is running…"
              : "Ready to run.",
      actions: running
        ? []
        : completed
          ? [
              {
                id: "run",
                label: "Run again",
                response: "run",
                variant: "secondary",
              },
              {
                id: "continue",
                label: "Continue",
                response: "continue",
                variant: "primary",
              },
            ]
          : needsAttention
            ? [
                ...(hasApprovalChallenge
                  ? [
                      {
                        id: "approve",
                        label: "Approve and run",
                        response: "approve",
                        variant: "primary" as const,
                      },
                    ]
                  : []),
                {
                  id: "run",
                  label: "Run again",
                  response: "run",
                  variant: hasApprovalChallenge
                    ? ("secondary" as const)
                    : ("primary" as const),
                },
              ]
            : [
                {
                  id: "run",
                  label: "Run command",
                  response: "run",
                  variant: "primary",
                },
              ],
    },
  });
  return {
    ...view,
    resultTarget: "guided-flow",
    guidedFlow: {
      instanceId: instance.instanceId,
      stepId: step.id,
      revision: instance.revision,
    },
  };
}
