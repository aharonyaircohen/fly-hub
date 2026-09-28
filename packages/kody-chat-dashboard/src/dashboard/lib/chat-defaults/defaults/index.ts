/**
 * @fileType util
 * @domain kody
 * @pattern chat-defaults-bundle
 *
 * TS-embedded defaults for the Kody chat bundle. Re-exports the agent identity,
 * chat capability, workflows, and skills so consumers can import one bundle.
 */

export type {
  ChatCapabilityEntry,
  ChatWorkflowEntry,
  SkillEntry,
} from "./types";
export { DEFAULT_CHAT_CAPABILITY } from "./chat-capability";
export {
  DEFAULT_WORKFLOWS,
  DEFAULT_WORKFLOW_KODY_ANALYZER,
  DEFAULT_WORKFLOW_KODY_OPERATOR,
  DEFAULT_WORKFLOW_KODY_VIBE,
  DEFAULT_WORKFLOW_KODY_MEM,
} from "./workflows";
export {
  DEFAULT_SKILL_DIAGNOSE_PR,
  DEFAULT_SKILL_REPORT_ADVISE,
  DEFAULT_SKILL_TODO_PLANNER,
  DEFAULT_SKILL_READ_AGENCY_DOCUMENTATION,
} from "./skills-analyzer";
export {
  DEFAULT_SKILL_CREATE_ISSUE,
  DEFAULT_SKILL_CREATE_CAPABILITY,
  DEFAULT_SKILL_CREATE_AGENT,
  DEFAULT_SKILL_CREATE_WORKFLOW,
  DEFAULT_SKILL_SELF_CONFIGURE,
  DEFAULT_SKILL_RUN_WORKFLOW,
  DEFAULT_SKILL_AUTHOR_QUALITY,
} from "./skills-operator";
export { DEFAULT_SKILL_VIBE } from "./skills-vibe";
export { DEFAULT_SKILL_MEMORY } from "./skills-mem";
export { DEFAULT_IDENTITY_MD, FOLLOW_UP_QUESTION_CONTRACT } from "./agent";

import { DEFAULT_SKILL_DIAGNOSE_PR } from "./skills-analyzer";
import { DEFAULT_SKILL_REPORT_ADVISE } from "./skills-analyzer";
import { DEFAULT_SKILL_TODO_PLANNER } from "./skills-analyzer";
import { DEFAULT_SKILL_READ_AGENCY_DOCUMENTATION } from "./skills-analyzer";
import { DEFAULT_SKILL_CREATE_ISSUE } from "./skills-operator";
import { DEFAULT_SKILL_CREATE_CAPABILITY } from "./skills-operator";
import { DEFAULT_SKILL_CREATE_AGENT } from "./skills-operator";
import { DEFAULT_SKILL_CREATE_WORKFLOW } from "./skills-operator";
import { DEFAULT_SKILL_SELF_CONFIGURE } from "./skills-operator";
import { DEFAULT_SKILL_RUN_WORKFLOW } from "./skills-operator";
import { DEFAULT_SKILL_AUTHOR_QUALITY } from "./skills-operator";
import { DEFAULT_SKILL_VIBE } from "./skills-vibe";
import { DEFAULT_SKILL_MEMORY } from "./skills-mem";
import type { SkillEntry } from "./types";

export const DEFAULT_SKILLS: Record<string, SkillEntry> = {
  [DEFAULT_SKILL_DIAGNOSE_PR.slug]: DEFAULT_SKILL_DIAGNOSE_PR,
  [DEFAULT_SKILL_REPORT_ADVISE.slug]: DEFAULT_SKILL_REPORT_ADVISE,
  [DEFAULT_SKILL_TODO_PLANNER.slug]: DEFAULT_SKILL_TODO_PLANNER,
  [DEFAULT_SKILL_READ_AGENCY_DOCUMENTATION.slug]:
    DEFAULT_SKILL_READ_AGENCY_DOCUMENTATION,
  [DEFAULT_SKILL_CREATE_ISSUE.slug]: DEFAULT_SKILL_CREATE_ISSUE,
  [DEFAULT_SKILL_CREATE_CAPABILITY.slug]: DEFAULT_SKILL_CREATE_CAPABILITY,
  [DEFAULT_SKILL_CREATE_AGENT.slug]: DEFAULT_SKILL_CREATE_AGENT,
  [DEFAULT_SKILL_CREATE_WORKFLOW.slug]: DEFAULT_SKILL_CREATE_WORKFLOW,
  [DEFAULT_SKILL_SELF_CONFIGURE.slug]: DEFAULT_SKILL_SELF_CONFIGURE,
  [DEFAULT_SKILL_RUN_WORKFLOW.slug]: DEFAULT_SKILL_RUN_WORKFLOW,
  [DEFAULT_SKILL_AUTHOR_QUALITY.slug]: DEFAULT_SKILL_AUTHOR_QUALITY,
  [DEFAULT_SKILL_VIBE.slug]: DEFAULT_SKILL_VIBE,
  [DEFAULT_SKILL_MEMORY.slug]: DEFAULT_SKILL_MEMORY,
};
