import type { RenderedViewDirective } from "../../chat-ui-actions";
import type { RenderedViewAction } from "../../chat-ui-actions";
import { getBuiltinViewRendererDefinition } from "../../view-renderers/builtin";
import { buildRenderedViewDirective } from "../../view-renderers/template";

export const PROJECT_ASSESSMENT_REQUEST =
  "Run a complete deep project assessment for this repository.";

export const PROJECT_ASSESSMENT_OPENING_ACTION: RenderedViewAction = {
  id: "run-project-assessment",
  label: "Run project assessment",
  response: PROJECT_ASSESSMENT_REQUEST,
  variant: "primary",
};

/** Supplies generic chat data to the existing opening-status renderer. */
export function buildRepositoryChatOpeningView(
  conversationId: string,
  additionalActions: readonly RenderedViewAction[] = [],
  options: { scope?: "repository" | "personal" } = {},
): RenderedViewDirective {
  const renderer = getBuiltinViewRendererDefinition("guided-flow-status");
  if (!renderer) throw new Error("Chat opening status renderer not found");

  const repository = options.scope !== "personal";

  return buildRenderedViewDirective({
    id: `chat-opening-${conversationId}`,
    definition: renderer,
    data: {
      greeting: repository ? "Hi! I can help you with:" : "Hi! I’m Kody.",
      title: repository ? "Start with this repository." : "Your private Chat",
      step: repository
        ? "Ask about the code, plan work, or run a deep health check."
        : "Chat is ready. Ask Kody anything, or attach a repository when you need repository tools.",
      instanceId: conversationId,
      actions: repository
        ? [PROJECT_ASSESSMENT_OPENING_ACTION, ...additionalActions]
        : [...additionalActions],
    },
  });
}
