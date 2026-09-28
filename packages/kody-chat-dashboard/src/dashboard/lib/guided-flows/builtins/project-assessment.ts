import {
  buildGuidedFlowFromRequestBlueprint,
  type RequestBlueprintDefinition,
} from "../../request-blueprints";

export const PROJECT_ASSESSMENT_FLOW_ID = "project-assessment";

const questions = [
  {
    id: "project-expectations",
    name: "projectExpectations",
    title: "Project goals and expected growth",
    explanation:
      "What should this project achieve over the next 12–24 months? Include expected users or load, growth, major product or technical changes, and important deadlines.",
  },
  {
    id: "business-criticality",
    name: "businessCriticality",
    title: "Business importance and acceptable failures",
    explanation:
      "Explain what happens if the system is unavailable, loses data, or has a security incident. Include acceptable downtime or data loss, customer or revenue impact, and any legal or compliance needs.",
  },
  {
    id: "team-size-and-roles",
    name: "teamSizeAndRoles",
    title: "Active team size and roles",
    explanation:
      "Who regularly builds, reviews, operates, or supports this system? Include employees, contractors, and AI agents, their roles, and whether their involvement is full-time or part-time.",
  },
  {
    id: "relevant-experience",
    name: "relevantExperience",
    title: "Relevant team experience",
    explanation:
      "Describe the team’s experience with the main technologies, architecture, expected scale, security, and production operations. Mention important areas where the team is still learning.",
  },
  {
    id: "system-knowledge",
    name: "systemKnowledge",
    title: "Shared system knowledge and ownership gaps",
    explanation:
      "Who understands the important areas today, and how well is that knowledge documented or shared? Mention new team members, knowledge gaps, and areas understood by only one person.",
  },
  {
    id: "maintenance-time",
    name: "maintenanceTime",
    title: "Real maintenance time available",
    explanation:
      "How much time can the team actually spend on maintenance after feature work and support? Include time for technical debt, refactoring, tests, dependencies, and security, using a weekly or monthly estimate.",
  },
  {
    id: "additional-comments",
    name: "additionalComments",
    title: "Other comments or report preferences",
    explanation:
      "Optional. Add anything else Kody should consider, such as asking for the report in another language or emphasizing a specific concern. You can leave this blank.",
  },
] as const;

const requirements: RequestBlueprintDefinition["requirements"] = questions.map(
  (question, index) => ({
    id: question.id,
    key: question.name,
    title: question.title,
    guidance: question.explanation,
    source: "user" as const,
    required: index !== questions.length - 1,
  }),
);

export const PROJECT_ASSESSMENT_REQUEST_BLUEPRINT_V1: RequestBlueprintDefinition =
  {
    id: PROJECT_ASSESSMENT_FLOW_ID,
    version: 1,
    title: "Project assessment",
    purpose:
      "Collect project context before Kody runs an evidence-based assessment.",
    allowBack: true,
    requirements,
    completion: { submitLabel: "Start assessment" },
  };

export const PROJECT_ASSESSMENT_FLOW_V1 = buildGuidedFlowFromRequestBlueprint(
  PROJECT_ASSESSMENT_REQUEST_BLUEPRINT_V1,
);

export const PROJECT_ASSESSMENT_REQUEST_BLUEPRINT: RequestBlueprintDefinition =
  {
    id: PROJECT_ASSESSMENT_FLOW_ID,
    version: 2,
    title: "Project assessment",
    purpose:
      "Explain and collect the context required for Kody's full project assessment.",
    introduction: {
      title: "Deep project assessment",
      guidance:
        "Kody will build an evidence-based view of the project before recommending what to improve.\n\n- Kody automatically inspects the repository, GitHub history, architecture, code quality, tests, security, delivery, operations, scalability, and product QA.\n- You answer seven questions about goals, business risk, team capacity, experience, system knowledge, maintenance time, and report preferences.\n- Each answer is saved as you continue, so you can leave and resume later.\n- After the final answer, Kody runs up to ten assessment tracks in parallel and combines them into one report: a business overview first, followed by technical evidence and priorities.\n\nThe assessment creates a report. It does not change the product code.",
      actionLabel: "Begin questions",
    },
    allowBack: true,
    requirements,
    completion: { submitLabel: "Start assessment" },
  };

export const PROJECT_ASSESSMENT_FLOW = buildGuidedFlowFromRequestBlueprint(
  PROJECT_ASSESSMENT_REQUEST_BLUEPRINT,
);
