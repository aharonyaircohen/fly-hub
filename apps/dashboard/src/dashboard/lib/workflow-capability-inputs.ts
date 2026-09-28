import type { WorkflowDefinition } from "@dashboard/lib/workflow-definitions";

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/**
 * A workflow's public input enters through its stable start step. When that
 * step has no explicit mapping, its Capability contract is the unambiguous
 * form and field mapping for the Workflow entry boundary.
 */
export function wireWorkflowEntryInputs(
  workflow: WorkflowDefinition,
  contractJson: string | null,
): WorkflowDefinition {
  const steps = workflow.steps ?? [];
  const entryIndex = steps.findIndex(
    (step) => step.id === (workflow.startAt ?? steps[0]?.id),
  );
  if (entryIndex < 0 || workflow.inputSchema) return workflow;
  if (
    steps[entryIndex]?.inputs &&
    Object.keys(steps[entryIndex]!.inputs!).length > 0
  ) return workflow;
  if (!contractJson) return workflow;

  let contract: JsonObject | null = null;
  try {
    contract = objectValue(JSON.parse(contractJson));
  } catch {
    return workflow;
  }
  const input = objectValue(contract?.input);
  const properties = objectValue(input?.properties);
  if (input?.type !== "object" || !properties) return workflow;

  const fields = Object.keys(properties).filter((field) =>
    /^[A-Za-z_][A-Za-z0-9_-]*$/.test(field),
  );
  if (fields.length === 0) return workflow;

  return {
    ...workflow,
    inputSchema: input,
    steps: steps.map((step, index) =>
      index === entryIndex
        ? {
            ...step,
            inputs: Object.fromEntries(
              fields.map((field) => [field, { from: `workflow.input.${field}` }]),
            ),
          }
        : step,
    ),
  };
}

export const wireSingleCapabilityInputs = wireWorkflowEntryInputs;
