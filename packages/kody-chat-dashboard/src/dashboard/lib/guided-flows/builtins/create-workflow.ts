import type { GuidedFlowDefinition } from "../model";

export const CREATE_WORKFLOW_FLOW_ID = "create-workflow";

export const CREATE_WORKFLOW_FLOW: GuidedFlowDefinition = {
  id: CREATE_WORKFLOW_FLOW_ID,
  version: 1,
  title: "Create a workflow",
  completionRouteId: "workflows",
  controls: ["back"],
  steps: [
    {
      id: "choose-capability",
      title: "Describe the workflow",
      explanation:
        "Give the workflow a name and the capability slug it should run.\n\nUse a capability slug that already exists in this repository.",
      rendererSlug: "guided-form",
      rendererData: {
        title: "What should this workflow run?",
        fields: [
          { name: "workflowName", label: "Workflow name", value: "" },
          { name: "capabilitySlug", label: "Capability slug", value: "" },
        ],
        submitLabel: "Review workflow",
      },
      actions: [{ id: "submit", target: { type: "step", stepId: "review" } }],
    },
    {
      id: "review",
      title: "Review workflow setup",
      explanation:
        "Confirm this starting point before creating the workflow.\n\nKody will create the workflow definition and open the Workflows page.",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Create this workflow?",
        actions: [
          {
            id: "approve",
            label: "Create workflow",
            response: "approve",
            variant: "primary",
          },
          {
            id: "cancel",
            label: "Cancel",
            response: "cancel",
            variant: "secondary",
          },
        ],
      },
      actions: [
        { id: "approve", target: { type: "complete" } },
        { id: "cancel", target: { type: "cancel" } },
      ],
    },
  ],
};
