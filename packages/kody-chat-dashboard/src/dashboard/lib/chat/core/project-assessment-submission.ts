import { PROJECT_ASSESSMENT_REQUEST } from "./chat-opening";

const PROJECT_ASSESSMENT_ANSWER_KEYS = [
  "projectExpectations",
  "businessCriticality",
  "teamSizeAndRoles",
  "relevantExperience",
  "systemKnowledge",
  "maintenanceTime",
  "additionalComments",
] as const;

/** Convert completed GuidedFlow data into the existing assessment routing input. */
export function buildProjectAssessmentSubmission(
  instanceId: string | undefined,
  data: Readonly<Record<string, unknown>> | undefined,
): string {
  const result = Object.fromEntries(
    PROJECT_ASSESSMENT_ANSWER_KEYS.map((key) => [key, data?.[key] ?? ""]),
  );
  const payload = JSON.stringify({
    kind: "view_result",
    view: "guided-flow",
    viewId: instanceId,
    rendererSlug: "project-assessment",
    actionId: "submit",
    result,
  });
  return `${PROJECT_ASSESSMENT_REQUEST}\n\n<view_result>${payload}</view_result>`;
}
