import type { PipelineDefinition } from "@dashboard/lib/pipeline-definitions";
import { readTrust } from "@dashboard/lib/cto/trust-store";
import {
  automationEligibilityForSubject,
  trustSubjectKey,
} from "@dashboard/lib/cto/trust-state";

export type PipelineAutomationEligibility =
  { eligible: true } | { eligible: false; reason: "approval-required" };

export async function pipelineAutomationEligibility(
  pipelines: ReadonlyArray<{ id: string; pipeline: PipelineDefinition }>,
): Promise<Map<string, PipelineAutomationEligibility>> {
  const trust = await readTrust();
  return new Map(
    pipelines.map(({ id, pipeline }) => [
      id,
      automationEligibilityForSubject(
        trust,
        trustSubjectKey("pipeline", id),
        pipeline.runWithoutApproval === true,
      ),
    ]),
  );
}

export async function pipelineRequiresApproval(
  pipelineId: string,
  pipeline: PipelineDefinition,
): Promise<boolean> {
  const eligibility = await pipelineAutomationEligibility([
    { id: pipelineId, pipeline },
  ]);
  return eligibility.get(pipelineId)?.eligible !== true;
}
