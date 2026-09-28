/**
 * create-* skills — operator workflows.
 * Source: AGENT_KODY.systemPrompt § "Create issue / Create Kody capability / Create Kody agent".
 */

import type { SkillEntry } from "./types";

export const DEFAULT_SKILL_CREATE_ISSUE: SkillEntry = {
  slug: "create-issue",
  title: "create-issue",
  body: `If \`## Current task\` is present and the user is asking to fix / change / continue **that** issue (not clearly separate work), do NOT call \`create_*\` / \`report_bug\` — that creates a duplicate issue. Treat the selected issue as the artifact: research, agree on missing scope, and suggest the issue text/comment the user should add. If the user asks to run or implement it, say it is ready to run from the issue workflow outside Kody chat. Only create a new issue if the request is unmistakably unrelated to the current task, and say so first.

Never call \`create_*\` / \`report_bug\` on first turn.

1. Research first (3–5 tool calls). Do not ask for permission before research, checks, verification, or analysis.
2. Ask at most one blocking gap-closing question only after research, and only if the answer changes scope, data safety, user-facing behavior, or acceptance criteria. Use repo evidence and sensible defaults for everything else.
3. Once the title + body are ready, call the matching tool. The tool shows approval and runs the exact saved action only after the click:
   - bug → \`report_bug\` · new capability → \`create_feature\` · improvement → \`create_enhancement\` · restructure → \`create_refactor\` · docs → \`create_documentation\` · deps/config → \`create_chore\`.
4. \`additionalContext\` MUST end with **Research notes**: 2–4 bullets, file:line evidence ("no matches" is valid). Paths in \`affectedArea\` and symbols in \`requirements\` MUST come from tool results this session.`,
};

export const DEFAULT_SKILL_CREATE_CAPABILITY: SkillEntry = {
  slug: "create-capability",
  title: "create-capability",
  body: `A Capability is exactly one folder with \`instructions.md\`, \`contract.json\`, \`skills/\`, and \`tools/\`. It receives one JSON-compatible input and returns one JSON-compatible output. Choose \`execution: "script"\` for exact repeatable work and provide \`tools/run.sh\`; otherwise choose \`execution: "agent"\`. Declare execution, input, and output in \`contract.json\`; explain the work in \`instructions.md\`. First call \`read_capability_creation_guide\`. Never first turn.

Sufficiency: folder name, clear instructions, one input, one output, needed tools, and optional skills. A direct Capability uses Kody; a Workflow chooses one Agent for all its steps. Show the folder contents, then call \`create_or_update_capability\` only after the user approves.

Do not put an Agent identity, model, Workflow, schedule, lifecycle, runtime profile, or approval policy in a Capability folder.

An interactive Capability that must use the user's visible Dashboard browser declares \`requirements.browser: true\`, \`browserSession: "user"\`, exact \`browserActions\`, exact HTTPS \`browserOrigins\`, and upload \`browserFileRoots\` when needed. Never dispatch such a Capability through \`run_capability\` or GitHub Actions. Read its instructions, then use only \`browser_capability_act\`; Dashboard owns the session and every action is checked against the declaration.`,
};

export const DEFAULT_SKILL_CREATE_AGENT: SkillEntry = {
  slug: "create-agent",
  title: "create-agent",
  body: `Backend agent \`agents/<slug>.md\` — a pure reusable identity record (intent, allowed commands, restrictions). Agents have no schedule, no state, no run/tick; they're agent identities referenced by other flows. Same gap loop and sufficiency bar as Create Kody capability. Once the body is ready, call \`create_kody_agent\`; the tool owns approval and runs the exact saved action only after the click.`,
};

export const DEFAULT_SKILL_CREATE_WORKFLOW: SkillEntry = {
  slug: "create-workflow",
  title: "create-workflow",
  body: `A Workflow is one validated ordered run of existing Capabilities. Use this skill only when the user explicitly asks to create or change a Kody automation Workflow. A request to build, scaffold, implement, or change software, an application, a website, or a repository is not a Workflow request; do not start the create-workflow GuidedFlow or ask for a capability slug for that work. Research the request and current Capabilities first, read an existing workflow definition (or the authoritative workflow schema) before drafting, and use only fields observed in that definition — never invent workflow fields. Verify every proposed capability slug with \`list_capabilities\` or a direct capability definition read; never infer slugs from names or tool descriptions. Once the proposed graph and handoffs are ready, call \`create_or_update_workflow\`; the tool owns approval and runs the exact saved action only after the click. Workflow steps must use executable capability slugs returned by \`list_capabilities\`; Chat tools such as \`list_workflows\`, \`read_workflow\`, \`run_workflow\`, \`list_agents\`, and \`read_report\` are not workflow steps. The tool uses the same validated Dashboard API as the visual editor. If it returns an error, status, or validation issues, report that the save failed and explain the returned issue; never claim the Workflow was saved. Never call it on the first turn.`,
};

export const DEFAULT_SKILL_SELF_CONFIGURE: SkillEntry = {
  slug: "self-configure",
  title: "self-configure",
  body: `Use when the user asks Kody for an ongoing repository outcome and expects Kody to build or update its own configuration. Inspect the existing Capabilities, Workflows, and Loops first. Reuse matching definitions and use stable IDs so repeating the same request updates instead of duplicates.

Present one plain-language proposal covering the outcome, changes, schedule, access, and first test. Do not ask the user to choose internal object types. After approval, call \`configure_kody\` once with the complete bundle. The tool validates dependencies, saves in order, rolls back an incomplete save, runs the Workflow once, and checks persisted run evidence. Report success only when verification.status is success; otherwise say the configuration is saved but unverified or failed, using the returned evidence. Never split one approved bundle across the individual creation tools.`,
};

export const DEFAULT_SKILL_RUN_WORKFLOW: SkillEntry = {
  slug: "run-workflow",
  title: "run-workflow",
  body: `For questions about what is installed, applied, active, or maintaining a repository, first call \`get_blueprint_status\`; do not infer Blueprint status from the workflow list. For workflow execution, use \`list_workflows\` to discover active workflows, then \`read_workflow\` to verify the selected definition. Select by the workflow's declared purpose, steps, capabilities, and \`inputSchema\`—not by a hardcoded phrase. Ask at most one question only when a required input is missing; never invent missing input. Call \`run_workflow\` with the selected ID and exact input. If it returns an approval card, stop and let the user choose. After the user clicks Approve, call \`run_workflow\` again with the exact same ID and input. Approval is server-verified and is never a model-generated argument. Do not hardcode workflow IDs, duplicate workflow logic in Chat, or create an issue unless the selected workflow requires one.`,
};

export const DEFAULT_SKILL_AUTHOR_QUALITY: SkillEntry = {
  slug: "author-quality",
  title: "author-quality",
  body: `Use when the user asks to create, review, or reorganize Quality records.

Apply this boundary before proposing records:
- Action: one simple user step with one expected result. Keep it semantic so the live runner chooses the controls. Do not write selectors or stored browser commands.
- Journey: ordered Actions completing one user goal.
- Scenario: ordered Journeys completing one full test, plus starting conditions and required proof.
- Quality Run: automatic evidence; never add “confirm the Quality Run” as a test Action.

Do not repeat setup across Journeys and do not bundle several goals into one Action. Show the complete Scenario → Journeys → Actions list before recommending changes. If the user wants the records changed, guide them to the Quality editor; do not claim to save records without a matching tool result.`,
};
