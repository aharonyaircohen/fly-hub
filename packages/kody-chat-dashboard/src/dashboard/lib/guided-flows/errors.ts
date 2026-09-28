export type GuidedFlowCompositionErrorCode =
  | "child_not_completed"
  | "nested_definition_mismatch"
  | "nested_flow_unavailable"
  | "nesting_depth_exceeded"
  | "parent_definition_mismatch"
  | "parent_flow_unavailable"
  | "parent_not_waiting"
  | "recursive_flow"
  | "step_not_nested";

export class GuidedFlowCompositionError extends Error {
  constructor(
    readonly code: GuidedFlowCompositionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GuidedFlowCompositionError";
  }
}

const GUIDED_FLOW_ERROR_MESSAGES: Record<string, string> = {
  invalid_guided_flow_input:
    "Please complete the current step before continuing.",
  guided_flow_not_found:
    "This Guided Flow is no longer available. Please start it again.",
  revision_conflict:
    "This Guided Flow changed in another chat. Please resume it again.",
  step_conflict:
    "This Guided Flow step is out of date. Please resume it again.",
  guided_flow_workflow_exists:
    "A workflow with this name already exists. Choose a different name and try again.",
  guided_flow_invalid_workflow:
    "This workflow cannot be created with the selected capability. Check the capability and try again.",
  guided_flow_auth_failed:
    "Your repository connection needs attention before this workflow can be created.",
  guided_flow_rate_limited:
    "The repository service is temporarily busy. Please try again shortly.",
  guided_flow_completion_failed:
    "The requested action could not finish yet. Your progress is saved; please try again.",
  guided_flow_control_disabled:
    "This control is not enabled for this Guided Flow.",
  guided_flow_control_unavailable:
    "This control is not available at the current step.",
  renderer_version_unpinned:
    "This saved flow uses an old unversioned renderer and cannot be resumed safely.",
  renderer_version_mismatch:
    "The exact renderer version required by this flow is unavailable.",
  renderer_data_invalid:
    "This flow's saved question data no longer matches its renderer.",
  renderer_unavailable: "The renderer required by this flow is unavailable.",
  renderer_contract_invalid:
    "This flow cannot be opened because its renderer contract is invalid.",
  nested_flow_unavailable:
    "A required Guided Flow is unavailable. Ask its owner to publish the referenced version.",
  recursive_flow:
    "This Guided Flow contains a recursive reference and cannot be started.",
  nesting_depth_exceeded:
    "This Guided Flow contains too many active nested flows.",
};

export function guidedFlowActionErrorMessage(errorCode?: string): string {
  return (
    (errorCode ? GUIDED_FLOW_ERROR_MESSAGES[errorCode] : undefined) ??
    "We couldn't continue this Guided Flow. Your progress is saved; please try again."
  );
}
