import { getBuiltinViewRendererDefinition } from "../view-renderers/builtin";
import {
  viewRendererDefinitionVersion,
  type ViewRendererDefinition,
} from "../view-renderers/definition";
import { normalizeViewRendererData } from "../view-renderers/template";
import {
  getGuidedFlowStep,
  isCommandGuidedFlowStep,
  isNestedGuidedFlowStep,
  type GuidedFlowDefinition,
  type GuidedFlowInstance,
} from "./controller";
import { guidedFlowRendererData } from "./render-data";

export type GuidedFlowCompatibility =
  | { readonly status: "compatible" }
  | {
      readonly status: "incompatible";
      readonly code:
        | "step_unavailable"
        | "renderer_unavailable"
        | "renderer_version_unpinned"
        | "renderer_version_mismatch"
        | "renderer_data_invalid";
      readonly message: string;
    };

export function evaluateGuidedFlowCompatibility({
  definition,
  instance,
  renderers = {},
}: {
  definition: GuidedFlowDefinition;
  instance: GuidedFlowInstance;
  renderers?: Readonly<Record<string, ViewRendererDefinition>>;
}): GuidedFlowCompatibility {
  let step;
  try {
    step = getGuidedFlowStep(definition, instance);
  } catch {
    return {
      status: "incompatible",
      code: "step_unavailable",
      message: "The current flow step is no longer available.",
    };
  }
  if (isNestedGuidedFlowStep(step)) {
    return {
      status: "incompatible",
      code: "step_unavailable",
      message: "The nested flow did not resolve to a visible step.",
    };
  }
  if (isCommandGuidedFlowStep(step)) return { status: "compatible" };

  const customRenderer =
    (step.rendererVersion !== undefined
      ? renderers[`${step.rendererSlug}@${step.rendererVersion}`]
      : undefined) ?? renderers[step.rendererSlug];
  const renderer =
    customRenderer ?? getBuiltinViewRendererDefinition(step.rendererSlug);
  if (!renderer) {
    return {
      status: "incompatible",
      code: "renderer_unavailable",
      message: `Renderer "${step.rendererSlug}" is unavailable.`,
    };
  }
  if (customRenderer && step.rendererVersion === undefined) {
    return {
      status: "incompatible",
      code: "renderer_version_unpinned",
      message: `Renderer "${step.rendererSlug}" was not versioned by this flow.`,
    };
  }
  const rendererVersion = viewRendererDefinitionVersion(renderer);
  if (
    step.rendererVersion !== undefined &&
    step.rendererVersion !== rendererVersion
  ) {
    return {
      status: "incompatible",
      code: "renderer_version_mismatch",
      message: `Renderer "${step.rendererSlug}" version ${step.rendererVersion} is unavailable.`,
    };
  }
  try {
    normalizeViewRendererData(renderer, guidedFlowRendererData(step));
  } catch (error) {
    return {
      status: "incompatible",
      code: "renderer_data_invalid",
      message:
        error instanceof Error
          ? error.message
          : "The renderer data is invalid.",
    };
  }
  return { status: "compatible" };
}

export function assertGuidedFlowCompatible(
  input: Parameters<typeof evaluateGuidedFlowCompatibility>[0],
): void {
  const compatibility = evaluateGuidedFlowCompatibility(input);
  if (compatibility.status === "incompatible") {
    throw new Error(`${compatibility.code}: ${compatibility.message}`);
  }
}

export function pinGuidedFlowRendererVersions(
  definition: GuidedFlowDefinition,
  renderers: Readonly<Record<string, ViewRendererDefinition>>,
): GuidedFlowDefinition {
  return {
    ...definition,
    steps: definition.steps.map((step) => {
      if (isNestedGuidedFlowStep(step) || isCommandGuidedFlowStep(step)) {
        return step;
      }
      const customRenderer =
        renderers[step.rendererSlug] ??
        (step.rendererVersion !== undefined
          ? renderers[`${step.rendererSlug}@${step.rendererVersion}`]
          : undefined);
      const renderer =
        customRenderer ?? getBuiltinViewRendererDefinition(step.rendererSlug);
      if (!renderer) {
        throw new Error(`renderer_unavailable: ${step.rendererSlug}`);
      }
      const rendererVersion = viewRendererDefinitionVersion(renderer);
      if (
        step.rendererVersion !== undefined &&
        step.rendererVersion !== rendererVersion
      ) {
        throw new Error(
          `renderer_version_mismatch: ${step.rendererSlug}@${step.rendererVersion}`,
        );
      }
      normalizeViewRendererData(renderer, guidedFlowRendererData(step));
      return { ...step, rendererVersion };
    }),
  };
}
