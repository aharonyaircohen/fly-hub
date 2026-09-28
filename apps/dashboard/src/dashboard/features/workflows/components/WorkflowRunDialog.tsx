"use client";

import type { WorkflowDefinitionRecord } from "@dashboard/lib/workflow-definitions";
import { RunInputDialog } from "./RunInputDialog";

export function WorkflowRunDialog(props: {
  workflow: WorkflowDefinitionRecord | null;
  pending: boolean;
  onClose(): void;
  onSubmit(input: Record<string, unknown>): Promise<void>;
}) {
  return (
    <RunInputDialog
      open={!!props.workflow}
      name={props.workflow?.workflow.name ?? "Workflow"}
      itemLabel="Workflow"
      inputSchema={props.workflow?.workflow.inputSchema}
      pending={props.pending}
      onClose={props.onClose}
      onSubmit={props.onSubmit}
    />
  );
}
