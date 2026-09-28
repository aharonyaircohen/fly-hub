/**
 * Kody chat workflow summaries.
 */
import type { ChatWorkflowEntry } from "./types";

export const DEFAULT_WORKFLOW_KODY_ANALYZER: ChatWorkflowEntry = {
  slug: "kody-analyzer",
  title: "kody-analyzer",
  body: `Read + propose workflows. Use when the user wants analysis, planning, or recommendation, not creation. Research and verification do not need approval.

Skills:
- diagnose-pr — analyze a Kody PR and find gaps between claims and diff.
- report-advise — read a report and recommend create-issue / add-Todo / no-action.
- todo-planner — decompose a finite outcome into concrete Todos.
- read-agency-documentation — read the existing CMS or repository documentation before explaining AI Agency models or usage.
- author-quality — create or review a clean Scenario → Journeys → Actions structure.

Output shape: use agentIdentity's deep question shape: verdict, ### Findings, ### What's missing or risky.`,
};

export const DEFAULT_WORKFLOW_KODY_OPERATOR: ChatWorkflowEntry = {
  slug: "kody-operator",
  title: "kody-operator",
  body: `Create-on-demand workflows. Use when the user approved a plan and wants an artifact created.

Skills:
- create-issue — research -> gap-closing -> show body -> call matching create_* / report_bug.
- create-capability — research -> gap-closing -> show profile/instructions -> call create_or_update_capability.
- create-agent — research -> gap-closing -> show body -> call create_kody_agent.
- create-workflow — research -> gap-closing -> show the workflow graph -> call create_or_update_workflow after approval.
- self-configure — inspect existing configuration -> show one outcome proposal -> call configure_kody once after approval -> report verified run evidence.
- run-workflow — discover, inspect, approve, and run any active workflow through the shared Engine boundary.

Hard rules: research before asking; never call create_* / report_bug on the first turn. Show title + body once approved, then call the tool. additionalContext must end with Research notes.`,
};

export const DEFAULT_WORKFLOW_KODY_VIBE: ChatWorkflowEntry = {
  slug: "kody-vibe",
  title: "kody-vibe",
  body: `Research -> plan -> create issue flow. Use inside Vibe workspace (vibeMode on). Research and verification do not need approval.

Skills:
- vibe — issue-only Vibe flow: research extensively -> plan -> align -> create issue -> stop.

Override: in vibe, Kody chat does not dispatch runners, open branches, open draft PRs, or post @kody comments. Issue creation is the terminal action.`,
};

export const DEFAULT_WORKFLOW_KODY_MEM: ChatWorkflowEntry = {
  slug: "kody-mem",
  title: "kody-mem",
  body: `Persistent memory management. Use when the user asks Kody to remember, correct, recall, list, or forget durable context.

Skills:
- memory — use relevant Convex retrieval plus recall / recall_search / list_memories. Triggers include an explicit memory command, correction, recall, inventory, or forget request. Kinds: preference, fact, decision, reference. Use update_memory for corrections and never create duplicates.`,
};

export const DEFAULT_WORKFLOWS = [
  DEFAULT_WORKFLOW_KODY_ANALYZER,
  DEFAULT_WORKFLOW_KODY_OPERATOR,
  DEFAULT_WORKFLOW_KODY_VIBE,
  DEFAULT_WORKFLOW_KODY_MEM,
];
