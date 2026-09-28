import {
  createWorkflowApprovalChallenge,
  verifyWorkflowApprovalChallenge,
  workflowRunAction,
} from "./workflow-run-approval";

export const pipelineRunAction = workflowRunAction;

export function createPipelineApprovalChallenge(input: {
  owner: string;
  repo: string;
  actor: string;
  pipelineId: string;
  input: Record<string, unknown>;
  signingKey: string;
}) {
  return createWorkflowApprovalChallenge({
    ...input,
    workflowId: `pipeline-${input.pipelineId}`,
  });
}

export function verifyPipelineApprovalChallenge(input: {
  owner: string;
  repo: string;
  actor: string;
  pipelineId: string;
  input: Record<string, unknown>;
  signingKey: string;
  token: string;
}) {
  return verifyWorkflowApprovalChallenge({
    ...input,
    workflowId: `pipeline-${input.pipelineId}`,
  });
}
