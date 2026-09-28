import type { GuidedFlowDefinition, GuidedFlowStepDefinition } from "../guided-flows/model";
import type {
  RequestBlueprintDefinition,
  RequestBlueprintGenerationContext,
  RequestBlueprintRequirement,
} from "./model";

export type {
  RequestBlueprintDefinition,
  RequestBlueprintGenerationContext,
  RequestBlueprintRequirement,
} from "./model";

function validateRequestBlueprint(definition: RequestBlueprintDefinition): void {
  if (!definition.id.trim()) throw new Error("Request Blueprint id is required");
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error("Request Blueprint version must be a positive integer");
  }
  if (!definition.title.trim()) throw new Error("Request Blueprint title is required");
  if (!definition.purpose.trim()) throw new Error("Request Blueprint purpose is required");
  if (definition.requirements.length === 0) {
    throw new Error("Request Blueprint must define at least one requirement");
  }

  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const requirement of definition.requirements) {
    if (!requirement.id.trim()) throw new Error("Request Blueprint requirement id is required");
    if (!requirement.key.trim()) throw new Error("Request Blueprint requirement key is required");
    if (!requirement.title.trim()) throw new Error("Request Blueprint requirement title is required");
    if (!requirement.guidance.trim()) throw new Error("Request Blueprint requirement guidance is required");
    if (ids.has(requirement.id)) {
      throw new Error(`Duplicate requirement id "${requirement.id}"`);
    }
    if (keys.has(requirement.key)) {
      throw new Error(`Duplicate requirement key "${requirement.key}"`);
    }
    ids.add(requirement.id);
    keys.add(requirement.key);
  }
}

function hasKnownValue(
  requirement: RequestBlueprintRequirement,
  context: RequestBlueprintGenerationContext,
): boolean {
  return Object.prototype.hasOwnProperty.call(context.knownValues ?? {}, requirement.key);
}

function questionStep(
  requirement: RequestBlueprintRequirement,
  index: number,
  total: number,
  nextStepId: string | undefined,
  submitLabel: string,
): GuidedFlowStepDefinition {
  return {
    id: requirement.id,
    title: requirement.title,
    explanation: requirement.guidance,
    rendererSlug: "guided-form",
    rendererData: {
      title: `Question ${index + 1} of ${total}`,
      fields: [
        {
          name: requirement.key,
          label: requirement.title,
          value: "",
          inputType: "textarea",
          ...(!requirement.required ? { description: "Optional" } : {}),
        },
      ],
      submitLabel: nextStepId ? "Continue" : submitLabel,
    },
    actions: [
      {
        id: "submit",
        target: nextStepId
          ? { type: "step", stepId: nextStepId }
          : { type: "complete" },
      },
    ],
  };
}

export function buildGuidedFlowFromRequestBlueprint(
  definition: RequestBlueprintDefinition,
  context: RequestBlueprintGenerationContext = {},
): GuidedFlowDefinition {
  validateRequestBlueprint(definition);
  const userRequirements = definition.requirements.filter(
    (requirement) => requirement.source === "user" && !hasKnownValue(requirement, context),
  );
  const questionSteps = userRequirements.map((requirement, index) =>
    questionStep(
      requirement,
      index,
      userRequirements.length,
      userRequirements[index + 1]?.id,
      definition.completion?.submitLabel ?? "Submit request",
    ),
  );
  const introduction = definition.introduction;
  const firstQuestionId = questionSteps[0]?.id;
  const introductionStep: GuidedFlowStepDefinition | null = introduction
    ? {
        id: "introduction",
        title: introduction.title,
        explanation: introduction.guidance,
        rendererSlug: "approval-card",
        rendererData: {
          title: introduction.title,
          actions: [
            {
              id: "continue",
              label: introduction.actionLabel ?? (firstQuestionId ? "Begin" : "Finish"),
              response: "continue",
              variant: "primary",
            },
          ],
        },
        actions: [
          {
            id: "continue",
            target: firstQuestionId
              ? { type: "step", stepId: firstQuestionId }
              : { type: "complete" },
          },
        ],
      }
    : null;
  const steps = [...(introductionStep ? [introductionStep] : []), ...questionSteps];
  if (steps.length === 0) {
    throw new Error("Request Blueprint generation produced no user steps");
  }

  return {
    id: definition.id,
    version: definition.version,
    title: definition.title,
    source: {
      type: "request-blueprint",
      id: definition.id,
      version: definition.version,
    },
    ...(definition.allowBack ? { controls: ["back" as const] } : {}),
    ...(definition.completion?.handoff
      ? { onComplete: { action: definition.completion.handoff } }
      : {}),
    steps,
  };
}

export function buildRequestBlueprintModelGuide(
  definition: RequestBlueprintDefinition,
): string {
  validateRequestBlueprint(definition);
  const requirements = definition.requirements.map((requirement, index) => {
    const owner = requirement.source === "kody" ? "Discover" : "Ask user";
    return `${index + 1}. ${owner}: ${requirement.title} (${requirement.required ? "required" : "optional"})\n   key: ${requirement.key}\n   guidance: ${requirement.guidance}`;
  });
  return [
    `Request Blueprint: ${definition.title}`,
    `Purpose: ${definition.purpose}`,
    "Discover repository facts before asking the user. Ask only for missing user decisions or context.",
    ...requirements,
    `Handoff: ${definition.completion?.handoff ?? "none"}`,
  ].join("\n");
}
