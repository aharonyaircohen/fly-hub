import type {
  WorkflowDefinition,
  WorkflowValidationIssue,
} from "@dashboard/lib/workflow-definitions";

export interface VerifiedWorkflowApproval {
  approvalId: string;
  action: string;
  expiresAt: string;
}

export interface ApproveWorkflowRunDependencies {
  verifyChallenge(): VerifiedWorkflowApproval | null;
  loadWorkflow(
    workflowId: string,
  ): Promise<{ workflow: WorkflowDefinition } | null>;
  validateWorkflow(
    workflow: WorkflowDefinition,
    input: Record<string, unknown>,
  ): WorkflowValidationIssue[];
  grantApproval(input: VerifiedWorkflowApproval): Promise<void>;
}

export type ApproveWorkflowRunResult =
  | { kind: "approved"; approvalId: string }
  | { kind: "invalid-approval" }
  | { kind: "not-found" }
  | { kind: "invalid"; issues: WorkflowValidationIssue[] };

export async function approveWorkflowRun(
  command: {
    workflowId: string;
    input: Record<string, unknown>;
  },
  dependencies: ApproveWorkflowRunDependencies,
): Promise<ApproveWorkflowRunResult> {
  const approval = dependencies.verifyChallenge();
  if (!approval) return { kind: "invalid-approval" };
  const loaded = await dependencies.loadWorkflow(command.workflowId);
  if (!loaded) return { kind: "not-found" };
  const issues = dependencies.validateWorkflow(loaded.workflow, command.input);
  if (issues.length > 0) return { kind: "invalid", issues };
  await dependencies.grantApproval(approval);
  return { kind: "approved", approvalId: approval.approvalId };
}
