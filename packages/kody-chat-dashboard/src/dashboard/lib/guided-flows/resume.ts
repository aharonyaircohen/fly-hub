import type {
  RenderedViewAction,
  RenderedViewDirective,
} from "../chat-ui-actions";
import { getBuiltinViewRendererDefinition } from "../view-renderers/builtin";
import { buildRenderedViewDirective } from "../view-renderers/template";
import type { GuidedFlowCompatibility } from "./compatibility";

export interface GuidedFlowResumeCandidate {
  readonly instance: {
    readonly instanceId: string;
    readonly revision: number;
    readonly status: "active" | "completed" | "cancelled";
  };
  readonly flow: {
    readonly title: string;
    readonly stepIndex: number;
    readonly stepCount: number;
  };
  readonly compatibility: GuidedFlowCompatibility;
}

export function buildGuidedFlowResumeView({
  sessionId,
  flows,
  additionalActions = [],
}: {
  sessionId: string;
  flows: readonly GuidedFlowResumeCandidate[];
  additionalActions?: readonly RenderedViewAction[];
}): RenderedViewDirective {
  const renderer = getBuiltinViewRendererDefinition("guided-flow-status");
  if (!renderer) throw new Error("GuidedFlow status renderer not found");
  const active = flows.filter(
    (candidate) => candidate.instance.status === "active",
  );
  const compatible = active.filter(
    (candidate) => candidate.compatibility.status === "compatible",
  );
  const actions = [
    ...compatible.map((candidate) => ({
      id: "resume",
      label:
        compatible.length === 1
          ? "Resume flow"
          : `${candidate.flow.title} · Step ${candidate.flow.stepIndex + 1} of ${candidate.flow.stepCount}`,
      response: "resume",
      variant: "primary" as const,
      result: { instanceId: candidate.instance.instanceId },
    })),
    ...additionalActions,
  ];
  const title =
    compatible.length === 0
      ? "How can Kody help?"
      : compatible.length === 1
        ? "You have an unfinished GuidedFlow."
        : "Choose a GuidedFlow to continue.";
  const step =
    compatible.length === 0
      ? "Choose an available action."
      : compatible.length === 1
        ? `${compatible[0].flow.title} · Step ${compatible[0].flow.stepIndex + 1} of ${compatible[0].flow.stepCount}`
        : `${compatible.length} available`;

  return buildRenderedViewDirective({
    id: `guided-flow-resume-${sessionId}`,
    definition: renderer,
    data: {
      greeting: "Hi! I can help you with:",
      title,
      step,
      instanceId: compatible[0]?.instance.instanceId ?? sessionId,
      actions,
    },
  });
}
