import {
  buildGuidedFlowFromRequestBlueprint,
  buildRequestBlueprintModelGuide,
} from ".";
import type { RequestBlueprintDefinition } from "./model";

export const CREATE_BLUEPRINT_FLOW_ID = "create-blueprint";

const questions = [
  {
    id: "desired-outcome",
    name: "desiredOutcome",
    title: "What should this Blueprint achieve?",
    explanation:
      "Describe the reusable outcome, not the implementation for only this repository.",
  },
  {
    id: "activation",
    name: "activation",
    title: "When should the installed Agency act?",
    explanation:
      "Say whether it runs once, after an event, on a schedule, or continuously.",
  },
  {
    id: "allowed-actions",
    name: "allowedActions",
    title: "What may the installed Blueprint change?",
    explanation:
      "State important limits, such as creating pull requests, merging, deploying, or reporting only.",
  },
  {
    id: "success-criteria",
    name: "successCriteria",
    title: "What proves the Blueprint works end to end?",
    explanation:
      "Describe the evidence that should make Kody mark the implementation complete.",
  },
  {
    id: "additional-context",
    name: "additionalContext",
    title: "What should Kody reuse or avoid?",
    explanation:
      "Optional. Name relevant Store components, repository types, providers, or constraints.",
    optional: true,
  },
] as const;

export const CREATE_BLUEPRINT_REQUEST_BLUEPRINT: RequestBlueprintDefinition = {
  id: CREATE_BLUEPRINT_FLOW_ID,
  version: 1,
  title: "Create Blueprint",
  purpose:
    "Create a reusable Store Blueprint that can be adapted to different repositories and verified end to end.",
  introduction: {
    title: "Define a reusable Blueprint",
    guidance:
      "Describe the reusable result and its boundaries once. Kody will inspect the repository, ask only if an important decision is still missing, and manage the work through the existing Agency request and Todo.",
    actionLabel: "Begin",
  },
  allowBack: true,
  requirements: questions.map((question) => ({
    id: question.id,
    key: question.name,
    title: question.title,
    guidance: question.explanation,
    source: "user" as const,
    required: !("optional" in question && question.optional),
  })),
  completion: {
    submitLabel: "Submit request",
    handoff: "agency-request.submit",
  },
};

export const CREATE_BLUEPRINT_FLOW = buildGuidedFlowFromRequestBlueprint(
  CREATE_BLUEPRINT_REQUEST_BLUEPRINT,
);

export const CREATE_BLUEPRINT_MODEL_GUIDE = buildRequestBlueprintModelGuide(
  CREATE_BLUEPRINT_REQUEST_BLUEPRINT,
);
