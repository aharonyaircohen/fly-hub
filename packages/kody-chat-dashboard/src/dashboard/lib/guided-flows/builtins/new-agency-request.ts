import {
  buildGuidedFlowFromRequestBlueprint,
  type RequestBlueprintDefinition,
} from "../../request-blueprints";

export const NEW_AGENCY_REQUEST_FLOW_ID = "new-agency-request";

const questions = [
  {
    id: "desired-outcome",
    name: "desiredOutcome",
    title: "What should Kody achieve?",
    explanation:
      "Describe the result you want. Kody will inspect the repository and determine how to achieve it.",
  },
  {
    id: "activation",
    name: "activation",
    title: "When should Kody act?",
    explanation:
      "Say whether this runs once, after an event, on a schedule, or continuously. Kody will discover the technical trigger.",
  },
  {
    id: "allowed-actions",
    name: "allowedActions",
    title: "What may Kody change?",
    explanation:
      "State important limits, such as whether Kody may edit code, create pull requests, merge, deploy, or only report findings.",
  },
  {
    id: "success-criteria",
    name: "successCriteria",
    title: "What proves success?",
    explanation:
      "Describe the evidence that should make Kody stop and report completion.",
  },
  {
    id: "additional-context",
    name: "additionalContext",
    title: "Anything else Kody should consider?",
    explanation:
      "Optional. Add useful context or leave this blank. Kody will inspect the repository and ask only if an important decision is still missing.",
  },
] as const;

export const NEW_AGENCY_REQUEST_BLUEPRINT: RequestBlueprintDefinition = {
  id: NEW_AGENCY_REQUEST_FLOW_ID,
  version: 1,
  title: "New Agency request",
  purpose:
    "Collect one durable automation requirement and hand it to AgencyRequestManager.",
  introduction: {
    title: "Before Kody takes responsibility",
    guidance:
      "Describe the result and the important boundaries once. Kody will then inspect the repository, check whether it can complete the job, ask only for missing decisions, and show the real plan for approval before changing anything.",
    actionLabel: "Begin",
  },
  allowBack: true,
  requirements: questions.map((question, index) => ({
    id: question.id,
    key: question.name,
    title: question.title,
    guidance: question.explanation,
    source: "user" as const,
    required: index !== questions.length - 1,
  })),
  completion: {
    submitLabel: "Submit request",
    handoff: "agency-request.submit",
  },
};

export const NEW_AGENCY_REQUEST_FLOW = buildGuidedFlowFromRequestBlueprint(
  NEW_AGENCY_REQUEST_BLUEPRINT,
);
