import type { RenderedViewUiNode } from "../chat-ui-actions";
import type { GuidedFlowControlId } from "./control-contract";
import {
  goBackGuidedFlow,
  type GuidedFlowDefinition,
  type GuidedFlowInstance,
} from "./controller";

interface GuidedFlowControlContext {
  readonly definition: GuidedFlowDefinition;
  readonly instance: GuidedFlowInstance;
}

interface GuidedFlowControlDefinition {
  readonly present: (
    context: GuidedFlowControlContext,
  ) => RenderedViewUiNode | null;
  readonly execute: (context: GuidedFlowControlContext) => GuidedFlowInstance;
}

export type GuidedFlowControlErrorCode =
  "guided_flow_control_disabled" | "guided_flow_control_unavailable";

export class GuidedFlowControlError extends Error {
  constructor(readonly code: GuidedFlowControlErrorCode) {
    super(code);
    this.name = "GuidedFlowControlError";
  }
}

function canGoBack({ instance }: GuidedFlowControlContext): boolean {
  return instance.backStack.length > 0;
}

function presentBackControl(
  context: GuidedFlowControlContext,
): RenderedViewUiNode | null {
  if (!canGoBack(context)) return null;

  return {
    type: "button",
    label: "Back",
    action: {
      id: "guided-flow-control-back",
      label: "Back",
      response: "back",
      variant: "secondary",
      dispatch: { type: "control", id: "back" },
    },
  };
}

function executeBackControl(
  context: GuidedFlowControlContext,
): GuidedFlowInstance {
  if (!canGoBack(context)) {
    throw new GuidedFlowControlError("guided_flow_control_unavailable");
  }
  return goBackGuidedFlow(context.definition, context.instance);
}

const GUIDED_FLOW_CONTROLS: Readonly<
  Record<GuidedFlowControlId, GuidedFlowControlDefinition>
> = {
  back: {
    present: presentBackControl,
    execute: executeBackControl,
  },
};

function enabledControl(
  definition: GuidedFlowDefinition,
  controlId: GuidedFlowControlId,
): GuidedFlowControlDefinition {
  if (!definition.controls?.includes(controlId)) {
    throw new GuidedFlowControlError("guided_flow_control_disabled");
  }
  return GUIDED_FLOW_CONTROLS[controlId];
}

export function presentGuidedFlowControls(
  context: GuidedFlowControlContext,
): RenderedViewUiNode[] {
  return (context.definition.controls ?? []).flatMap((controlId) => {
    const node = GUIDED_FLOW_CONTROLS[controlId].present(context);
    return node ? [node] : [];
  });
}

export function executeGuidedFlowControl({
  definition,
  instance,
  controlId,
}: GuidedFlowControlContext & {
  readonly controlId: GuidedFlowControlId;
}): GuidedFlowInstance {
  return enabledControl(definition, controlId).execute({
    definition,
    instance,
  });
}
