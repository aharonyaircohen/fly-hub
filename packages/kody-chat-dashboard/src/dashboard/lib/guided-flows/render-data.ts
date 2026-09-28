import type { GuidedFlowViewStepDefinition } from "./model";

/** Build renderer input from one canonical Markdown instruction source. */
export function guidedFlowRendererData(
  step: GuidedFlowViewStepDefinition,
): Readonly<Record<string, unknown>> {
  return {
    ...(step.rendererData ?? {}),
    body: step.explanation,
  };
}
