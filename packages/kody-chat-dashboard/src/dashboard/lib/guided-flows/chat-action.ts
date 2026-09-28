import type { RenderedViewAction } from "../chat-ui-actions";

export type GuidedFlowViewChange =
  | { readonly action: "control"; readonly controlId: string }
  | {
      readonly action: "submit";
      readonly actionId: string;
      readonly result?: Readonly<Record<string, unknown>>;
    };

export function guidedFlowChangeForViewAction(
  action: RenderedViewAction,
): GuidedFlowViewChange {
  if (action.dispatch?.type === "control") {
    return { action: "control", controlId: action.dispatch.id };
  }
  return {
    action: "submit",
    actionId: action.id,
    ...(action.result ? { result: action.result } : {}),
  };
}
