import type { WorkflowDefinition } from "@dashboard/lib/workflow-definitions";
import type { LoopDefinition } from "@kody-ade/agency-domain";
import { readTrust } from "@dashboard/lib/cto/trust-store";
import {
  automationEligibilityForSubject,
  trustLevelForSubject,
  trustSubjectKey,
} from "@dashboard/lib/cto/trust-state";

export type WorkflowAutomationEligibility =
  { eligible: true } | { eligible: false; reason: "approval-required" };

function automationEligibility(
  trust: Awaited<ReturnType<typeof readTrust>>,
  workflowId: string,
  workflow: WorkflowDefinition,
): WorkflowAutomationEligibility {
  const subject = trustSubjectKey("workflow", workflowId);
  return automationEligibilityForSubject(
    trust,
    subject,
    workflow.runWithoutApproval === true,
  );
}

/** Resolve automation policy for a workflow collection with one trust read. */
export async function workflowAutomationEligibility(
  workflows: ReadonlyArray<{
    id: string;
    workflow: WorkflowDefinition;
  }>,
): Promise<Map<string, WorkflowAutomationEligibility>> {
  const trust = await readTrust();
  return new Map(
    workflows.map(({ id, workflow }) => [
      id,
      automationEligibility(trust, id, workflow),
    ]),
  );
}

export async function workflowRequiresApproval(
  workflowId: string,
  workflow: WorkflowDefinition,
): Promise<boolean> {
  const eligibility = await workflowAutomationEligibility([
    { id: workflowId, workflow },
  ]);
  return eligibility.get(workflowId)?.eligible !== true;
}

export async function authorizeLoopExecution(
  loopId: string,
  _loop: LoopDefinition,
  explicitlyApproved: boolean,
): Promise<boolean> {
  const trust = await readTrust();
  const subject = trustSubjectKey("loop", loopId);
  const level = trustLevelForSubject(trust.subjects[subject], false);
  return level !== "approval-required" || explicitlyApproved;
}
