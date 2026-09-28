import type {
  GuidedFlowDefinition,
  GuidedFlowInstance,
} from "@kody-ade/kody-chat-dashboard/guided-flows/controller";
import { getGuidedFlowStep } from "@kody-ade/kody-chat-dashboard/guided-flows/controller";
import { evaluateGuidedFlowCompatibility } from "@kody-ade/kody-chat-dashboard/guided-flows/compatibility";
import type { GuidedFlowCompatibility } from "@kody-ade/kody-chat-dashboard/guided-flows/compatibility";
import { buildGuidedFlowView } from "@kody-ade/kody-chat-dashboard/guided-flows/registry";
import type {
  DashboardNavigateDirective,
  RenderedViewDirective,
} from "../../../../src/dashboard/lib/chat-ui-actions";
import type { ViewRendererDefinition } from "../../../../src/dashboard/lib/view-renderers/definition";
import { navigationForCompletion, navigationForStep } from "./navigation";

export interface GuidedFlowPresentation {
  instance: GuidedFlowInstance;
  flow: {
    id: string;
    title: string;
    stepIndex: number;
    stepCount: number;
  };
  compatibility: GuidedFlowCompatibility;
  view?: RenderedViewDirective;
  navigation?: DashboardNavigateDirective;
}

export function presentGuidedFlow(
  definition: GuidedFlowDefinition,
  instance: GuidedFlowInstance,
  renderers?: Readonly<Record<string, ViewRendererDefinition>>,
): GuidedFlowPresentation {
  const compatibility =
    instance.status === "active"
      ? evaluateGuidedFlowCompatibility({
          definition,
          instance,
          renderers,
        })
      : ({ status: "compatible" } as const);
  return {
    instance,
    flow: {
      id: definition.id,
      title: definition.title,
      stepIndex: Math.max(
        0,
        definition.steps.findIndex(
          (step) => step.id === instance.currentStepId,
        ),
      ),
      stepCount: definition.steps.length,
    },
    compatibility,
    ...(instance.status === "active"
      ? compatibility.status === "compatible"
        ? {
            view: buildGuidedFlowView(definition, instance, renderers),
            navigation: navigationForStep(
              getGuidedFlowStep(definition, instance),
              instance,
            ),
          }
        : {}
      : { navigation: navigationForCompletion(definition) }),
  };
}
