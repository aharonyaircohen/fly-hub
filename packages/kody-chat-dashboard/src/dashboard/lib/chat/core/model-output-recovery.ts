import {
  RENDER_VIEW_DIRECTIVE,
  type RenderedViewDirective,
} from "../../chat-ui-actions";

export const MODEL_OUTPUT_RECOVERY_RENDERER = "model-output-recovery";
export const MODEL_OUTPUT_RECOVERY_ACTION = {
  retry: "retry",
  chooseModel: "choose-model",
  cancel: "cancel",
} as const;

export function isModelOutputRecoveryView(
  view: Pick<RenderedViewDirective, "rendererSlug">,
): boolean {
  return view.rendererSlug === MODEL_OUTPUT_RECOVERY_RENDERER;
}

export function buildModelOutputRecoveryView(input: {
  id: string;
  modelLabel: string;
}): RenderedViewDirective {
  const actions = [
    {
      id: MODEL_OUTPUT_RECOVERY_ACTION.retry,
      label: "Retry same model",
      response: "Retry my last request with the same model.",
      variant: "primary" as const,
    },
    {
      id: MODEL_OUTPUT_RECOVERY_ACTION.chooseModel,
      label: "Choose another model",
      response: "Choose another model.",
      variant: "secondary" as const,
    },
    {
      id: MODEL_OUTPUT_RECOVERY_ACTION.cancel,
      label: "Cancel",
      response: "Cancel this request.",
      variant: "secondary" as const,
    },
  ];

  const title = "This model could not complete the interaction";
  const body = `${input.modelLabel} did not return the required interactive response. Kody did not switch models or execute any plain-text tool call.`;

  return {
    action: RENDER_VIEW_DIRECTIVE,
    view: "renderer",
    id: input.id,
    rendererSlug: MODEL_OUTPUT_RECOVERY_RENDERER,
    rendererName: "Model output recovery",
    resultTarget: "chat",
    data: {
      title,
      body,
      actions,
    },
    ui: {
      type: "stack",
      children: [
        {
          type: "text",
          variant: "title",
          value: title,
        },
        {
          type: "text",
          value: body,
        },
        {
          type: "row",
          children: actions.map((action) => ({
            type: "button" as const,
            label: action.label,
            action,
          })),
        },
      ],
    },
  };
}
