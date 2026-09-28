export const GUIDED_FLOW_CONTROL_IDS = ["back"] as const;

export type GuidedFlowControlId = (typeof GUIDED_FLOW_CONTROL_IDS)[number];

export function hasUniqueGuidedFlowControls(
  controls: readonly GuidedFlowControlId[],
): boolean {
  return new Set(controls).size === controls.length;
}
