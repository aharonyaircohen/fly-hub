import type { GuidedFlowDefinition, GuidedFlowInstance } from "./model";

export function guidedFlowStepResult(
  definition: Pick<GuidedFlowDefinition, "id" | "version">,
  instance: Pick<GuidedFlowInstance, "data">,
  stepId: string,
): Readonly<Record<string, unknown>> | undefined {
  const stepResults = instance.data.stepResults;
  if (
    !stepResults ||
    typeof stepResults !== "object" ||
    Array.isArray(stepResults)
  ) {
    return undefined;
  }
  const recorded = (stepResults as Readonly<Record<string, unknown>>)[
    `${definition.id}@${definition.version}/${stepId}`
  ];
  if (!recorded || typeof recorded !== "object" || Array.isArray(recorded)) {
    return undefined;
  }
  const result = (recorded as { readonly result?: unknown }).result;
  return result && typeof result === "object" && !Array.isArray(result)
    ? (result as Readonly<Record<string, unknown>>)
    : undefined;
}
