import type {
  EngineExecutionReceipt,
  EngineExecutionRequest,
  EngineExecutionSource,
} from "@kody-ade/engine-contracts";
import type {
  WorkflowDefinition,
  WorkflowValidationIssue,
} from "@dashboard/lib/workflow-definitions";

export interface WorkflowExecutionDependencies {
  createRequestId(): string;
  now(): string;
  loadWorkflow(
    workflowId: string,
  ): Promise<{ workflow: WorkflowDefinition } | null>;
  validateDefinition(workflow: WorkflowDefinition): WorkflowValidationIssue[];
  validateResolvedCapabilities?(
    workflow: WorkflowDefinition,
  ): Promise<WorkflowValidationIssue[]>;
  validateInput(
    schema: WorkflowDefinition["inputSchema"],
    input: Record<string, unknown>,
  ): WorkflowValidationIssue[];
  requiresApproval(
    workflowId: string,
    workflow: WorkflowDefinition,
  ): Promise<boolean>;
  consumeApproval(input: {
    approvalId: string;
    workflowId: string;
    action: string;
    actor: string;
    dispatchKey: string;
    consumedAt: string;
  }): Promise<boolean>;
  actionFor(input: Record<string, unknown>): string;
  dispatch(request: EngineExecutionRequest): Promise<EngineExecutionReceipt>;
}

export interface StartWorkflowCommand {
  workflowId: string;
  source: EngineExecutionSource;
  actor: string;
  requestId?: string;
  resume?: boolean;
  approvalId?: string;
  input?: Record<string, unknown>;
}

export type StartWorkflowResult =
  | {
      kind: "accepted";
      workflowId: string;
      requestId: string;
      acceptedAt: string;
    }
  | { kind: "not-found" }
  | { kind: "approval-required" }
  | { kind: "invalid"; issues: WorkflowValidationIssue[] };

export async function startWorkflow(
  command: StartWorkflowCommand,
  dependencies: WorkflowExecutionDependencies,
): Promise<StartWorkflowResult> {
  const loaded = await dependencies.loadWorkflow(command.workflowId);
  if (!loaded) return { kind: "not-found" };

  const issues = [
    ...dependencies.validateDefinition(loaded.workflow),
    ...(dependencies.validateResolvedCapabilities
      ? await dependencies.validateResolvedCapabilities(loaded.workflow)
      : []),
    ...(command.resume
      ? []
      : dependencies.validateInput(
          loaded.workflow.inputSchema,
          command.input ?? {},
        )),
  ];
  if (issues.length > 0) return { kind: "invalid", issues };
  const requestId = command.requestId ?? dependencies.createRequestId();
  if (
    await dependencies.requiresApproval(command.workflowId, loaded.workflow)
  ) {
    if (!command.approvalId) return { kind: "approval-required" };
    const consumed = await dependencies.consumeApproval({
      approvalId: command.approvalId,
      workflowId: command.workflowId,
      action: dependencies.actionFor(command.input ?? {}),
      actor: command.actor,
      dispatchKey: requestId,
      consumedAt: dependencies.now(),
    });
    if (!consumed) return { kind: "approval-required" };
  }

  const receipt = await dependencies.dispatch({
    requestId,
    target: { type: "workflow", id: command.workflowId },
    intent: "run",
    source: command.source,
    ...(command.input ? { input: command.input } : {}),
  });

  return {
    kind: "accepted",
    workflowId: command.workflowId,
    requestId: receipt.requestId,
    acceptedAt: receipt.acceptedAt,
  };
}
