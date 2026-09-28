/**
 * Analyzer skills — read and propose, never dispatch implementation.
 */
import type { SkillEntry } from "./types";

export const DEFAULT_SKILL_DIAGNOSE_PR: SkillEntry = {
  slug: "diagnose-pr",
  title: "diagnose-pr",
  body: `Triggers: "diagnose PR #N", "what did kody miss", "audit the kody fix", "why didn't kody solve this".

Use the deep question shape from agentIdentity hard rule #3: verdict, ### Findings, ### What's missing or risky.

Workflow:
1. \`github_get_issue(N)\` to list claims verbatim.
2. \`github_get_pull_request({ number: N, includeDiff: true })\` to list files touched.
3. For each claim naming a field/function/behavior, use \`github_search_code\` + \`github_get_file\`. Check whether the diff touches the relevant path.
4. Claims not covered by diff = gap. No gap -> say so explicitly in ### Findings.
5. Draft follow-up notes: gap in one sentence, file:line evidence, what should change.
6. Show the draft notes and ask whether to create a tracking issue or leave the notes for the user. Do not dispatch a fix from Kody chat.`,
};

export const DEFAULT_SKILL_REPORT_ADVISE: SkillEntry = {
  slug: "report-advise",
  title: "report-advise",
  body: `When ## Current report block is present, the user is viewing a markdown report from a report family in the configured Kody backend. Recommend follow-up honestly: create an issue, add a Todo, or take no action. Default to no action unless the report contains a concrete, named problem the user has not already addressed.`,
};

export const DEFAULT_SKILL_TODO_PLANNER: SkillEntry = {
  slug: "todo-planner",
  title: "todo-planner",
  body: `You are planning a finite outcome. Research first without asking permission, decompose it into concrete Todos, ask for approval, then create the approved items. Do not start implementation from Kody chat.`,
};

export const DEFAULT_SKILL_READ_AGENCY_DOCUMENTATION: SkillEntry = {
  slug: "read-agency-documentation",
  title: "read-agency-documentation",
  body: `Use when the user asks about the AI Agency model or how Intent, Loop, Workflow, Capability, Agent, or Run should be used.

Read the existing authoritative documentation before answering:
1. When CMS tools are available, call \`cms_list_collections\`, identify the configured documentation collection, find the relevant document with \`cms_list_documents\`, then read it with \`cms_get_document\`.
2. If the CMS does not contain the relevant documentation, use \`github_search_code\` to locate it in the connected repository, then use \`github_get_file\` to read the complete relevant document. A search excerpt is not the document.
3. If the answer depends on more than one document, read every document needed for the answer.
4. Once authoritative documentation has been found and read, stop discovery and answer. Do not repeat searches, re-list the repository tree, or look for extra documents unless the documents already read explicitly leave the user's question unanswered.

Answer from what the documentation says and identify the source. If no authoritative documentation can be found, say so plainly instead of guessing. Do not create or copy documentation, add a graph or another knowledge system, or replace the existing documentation source.`,
};
