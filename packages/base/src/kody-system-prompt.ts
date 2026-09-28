/**
 * @fileType utility
 * @domain kody
 * @pattern system-prompt-builder
 *
 * Builds the Kody chat system prompt by stacking the base agent prompt, the
 * connected repository block, and the optional current-task block. Extracted
 * from route.ts so tests can import it without exporting non-HTTP handlers
 * from a Next.js route file.
 */
import { dashboardTaskUrl } from "@kody-ade/base/thread-link";

export interface TaskContext {
  issueNumber?: number | string;
  title?: string;
  body?: string;
  state?: string;
  labels?: string[];
  column?: string;
  pipeline?: { state?: string; currentStage?: string };
  associatedPR?: { number?: number; state?: string; html_url?: string };
}

export interface CapabilityContext {
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  labels?: string[];
}

export interface ReportContext {
  slug: string;
  title: string;
  body: string;
  path?: string;
}

export interface OrgContext {
  owner: string;
  repositories?: Array<{ owner: string; repo: string }>;
}

export interface AppContext {
  slug: string;
  repository: string;
  name: string;
  status: string;
  branch: string;
  rootDirectory: string;
  exposure: "private" | "public";
  currentDeploymentId?: string;
  secretNames: string[];
  domains: Array<{ hostname: string; status: string }>;
  storage: Array<{
    volumeId: string;
    name: string;
    mountPath: string;
    sizeGb: number;
  }>;
}

/**
 * Cap on how many lines of the memory INDEX we inject into the system prompt.
 * Each line is ~150 chars (one bullet per memory), so 300 lines ≈ 45KB of
 * prompt overhead — still a small fraction of the model's context window.
 * Above this the agent falls back to `recall_search` (GitHub code search
 * scoped to backend `memory/`) and `list_memories` / `recall` tools.
 */
const MEMORY_INDEX_MAX_LINES = 300;

export function formatUserInstructionsPromptSection(
  userInstructions: string | null | undefined,
): string | null {
  const body = userInstructions?.trim();
  if (!body) return null;

  return `## User instructions for this repo

The block below is the live contents of backend \`instructions.md\` for this repo — the user's explicit preferences for how you should behave in this chat. These OVERRIDE the base agent prompt for tone, length, formatting, audience, and any other preference the user has chosen to record here. Apply them automatically; do not narrate that you're applying them.

If a user instruction conflicts with a hard rule above (never fake tool calls, research before evaluating, issue-creation gates), the hard rule still wins — those exist to prevent footguns. Everything else, the user instruction wins.

When the instructions name the operator's role or audience, write for that person. For a PM, founder, or non-technical operator, lead with the business or product effect, avoid implementation detail by default, and mention files, functions, APIs, or logs only when the user asks for them or they are required proof.

${body}`;
}

function truncateMemoryContext(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines.length <= MEMORY_INDEX_MAX_LINES) return raw;
  const head = lines.slice(0, MEMORY_INDEX_MAX_LINES).join("\n");
  return (
    `${head}\n\n_Index truncated at ${MEMORY_INDEX_MAX_LINES} lines (${lines.length} total). ` +
    "Use `list_memories` to enumerate the rest._"
  );
}

export function buildSystemPrompt(
  base: string,
  repo: { owner: string; repo: string } | null,
  task: TaskContext | undefined,
  opts?: {
    capability?: CapabilityContext;
    report?: ReportContext;
    app?: AppContext;
    org?: OrgContext;
    /** Connected repository names only. Credentials must never enter prompts. */
    connectedRepositories?: Array<{ owner: string; repo: string }>;
    /**
     * The dashboard page the user is currently viewing, as a noun phrase
     * (e.g. "the Variables page (/variables)"). Lets the agent answer "what
     * am I looking at?" and resolve "this page" / "here" to a real surface.
     */
    currentPage?: string;
    /**
     * Preview/page evidence collected by the dashboard for this turn. This is
     * runtime context, not user-visible chat text: it tells the model that
     * "this page" may refer to the preview reference the user is looking at.
     */
    previewContext?: string;
    /** Relevant personal and repository memories retrieved for this turn. */
    memoryContext?: string | null;
    /**
  /**
   * Vibe mode. When true, chat is scoped to the Vibe workspace. It may
   * research, plan, and create issues, but it must not start Kody Live/Fly
   * or open PRs. The vibe override block is appended at the end so it wins
   * against base prompt executor-handoff framing.
   */
    vibeMode?: boolean;
    /**
     * Whether the user has a Fly Machines token configured. Kept for request
     * compatibility; Kody chat no longer auto-hands off to runners.
     */
    flyConfigured?: boolean;
    /**
     * Raw body of backend `instructions.md` (or `null` when the file doesn't
     * exist). Appended LAST inside the system prompt so it wins against
     * the base agent prompt for tone / length / formatting preferences.
     * Voice overlay still wins on mic turns — voice is applied outside
     * this builder in route.ts.
     */
    userInstructions?: string | null;
    /**
     * Concatenated bodies of the `kody`-owned backend `context/*.md` entries (or
     * `null` when the repo has none). Factual "who the company is / what it
     * does" context the agent should treat as background — injected near the
     * TOP (after the connected-repo block) so it frames everything, unlike
     * `userInstructions` which is appended LAST as a behavioral override.
     */
    context?: string | null;
    /** Hard, agent-scoped limits that must not be violated. */
    constraints?: string | null;
    /** Agent-scoped decision rules for choosing among allowed actions. */
    policies?: string | null;
    /**
     * User-managed renderer rules compiled from backend view renderers.
     * These tell the agent when to call `show_view` and which data keys matter.
     */
    viewRendererRules?: string | null;
  },
): string {
  const sections: string[] = [base];
  if (repo) {
    sections.push(
      `## Connected repository\n\nYou are helping the user with the repository **${repo.owner}/${repo.repo}**. When the user refers to "the repo", "this repo", "the codebase", or a file path, they mean this repository. Ground your answers in the conversation context the user provides — do not invent file contents or PR numbers you haven't seen.`,
    );
    sections.push(
      `## Repo file write safety — hard rule\n\nBefore any tool call that writes, replaces, creates, updates, or deletes repo-backed dashboard state, explicitly call matching read/list tool in same turn and inspect result. Mandatory even for quick edits.\n\nRequired pairs:\n- Before \`create_or_update_context\` or \`delete_context\`, call \`list_context\` to confirm candidates, then \`read_context\` for exact active slug when it exists.\n- Before \`set_instructions\` or \`delete_instructions\`, call \`read_instructions\`.\n- Before \`set_variable\` or \`delete_variable\`, call \`list_variables\`.\n- Before any other overwrite-style tool, use closest matching read/list/get tool first.\n\nIf multiple files, slugs, or variables could match user's request, do not guess. State active target found and ask user confirm before writing. When writing whole-file content, preserve existing content unless user clearly asked replace it.`,
    );
  }
  if (opts?.connectedRepositories?.length) {
    sections.push(`## Connected repositories

These repositories are connected to the signed-in account. The current repository is the default for ordinary work. When the user explicitly names a source and target, preserve both names and use the cross-repository tools instead of asking them to switch repositories.

${opts.connectedRepositories
  .map(
    (repository) =>
      `- ${repository.owner}/${repository.repo}${
        repo?.owner.toLowerCase() === repository.owner.toLowerCase() &&
        repo.repo.toLowerCase() === repository.repo.toLowerCase()
          ? " (current)"
          : ""
      }`,
  )
  .join("\n")}`);
  }
  if (opts?.currentPage && opts.currentPage.trim().length > 0) {
    sections.push(
      `## Current page

The user is currently viewing **${opts.currentPage.trim()}** in the dashboard. When they say "this page", "here", "what am I viewing", or "what is this", they mean this page — answer about it directly. Use your dashboard knowledge to describe it (call \`describe_feature\` with the matching id, e.g. the page slug, when you need the full rundown).`,
    );
  }
  if (opts?.previewContext && opts.previewContext.trim().length > 0) {
    sections.push(
      `## Current preview reference

The dashboard current page is only the container. The preview reference is the page the user sees. When the user asks what page, content, selection, or element they are viewing, answer from this preview reference and do not identify the dashboard container instead.

The user is looking at the preview reference below. When they say "make this page", "build this page", "create this page", "copy this page", "turn this into a page", or similar, treat it as a request to create a GitHub issue for the connected repo using the create-issue workflow. Do not answer with a fresh design direction, marketing copy, or implementation plan as the final artifact.

If an issue is created from this request, the preview reference is a required visual source for that issue.

${opts.previewContext.trim()}`,
    );
  }
  const viewRendererRules = opts?.viewRendererRules?.trim();
  sections.push(
    `## Generic view rendering

Every final response must use an output tool: \`show_view\` for a matching UI interaction, or \`final_answer\` for plain text.

If the user asks to show, render, or display a UI/card, that is also a render request. Do not print JSON or describe the tool call.

UI-card requests are display requests, not issue-creation requests. Render the requested UI; do not convert it into another workflow unless the user asks for that.

Use \`show_view\` naturally whenever your reply is presenting an interaction — choices, confirmations, edits, and continue/cancel decisions. The user does not need to ask for UI explicitly.

When the user asks to present structured records, statuses, choices, forms, or other data-shaped results, use \`show_view\` first. Keep explanations, analysis, diagnoses, and advice in \`final_answer\`, even when tools supplied supporting data. When both are useful, commit one short explanation with \`final_answer\` and follow it with \`show_view\` in the same response.

\`show_view\` takes a JSON spec (\`root\` + flat \`elements\` map) composed from the components listed in the tool description. Prefer a high-level view component when its purpose matches the interaction; compose from atoms when none fits.

If the user's request includes line-separated or bulleted choices, preserve each choice as its own button or list item.

If the user asks to list available records, first call the read/list tool needed to get the records, then call \`show_view\` with those records as a clear list. Add selection controls only when the user also asks to choose, pick, select, open, or allow selection.

Every value you place in the spec must come from one of two places:
- the user explicitly asked to put that value in the view,
- the value belongs to the current workflow step you are presenting for action.

Do not silently copy preview, page, repo, task, memory, or research context into view fields.
If \`show_view\` returns an error, fix the spec exactly as the error describes and call it again.${
      viewRendererRules
        ? `

Available view components and when to use them:
${viewRendererRules}`
        : ""
    }`,
  );
  if (opts?.org) {
    const repos = opts.org.repositories ?? [];
    const repoLines =
      repos.length > 0
        ? repos.map((r) => `- ${r.owner}/${r.repo}`).join("\n")
        : "- No repositories are attached in this dashboard org yet.";
    sections.push(
      `## Org workspace scope

You are helping user with dashboard org **${opts.org.owner}** across its Kody-managed repositories.

Attached repositories:
${repoLines}

Rules:
- Read and summary questions can use the org as the scope.
- Any write action, repo mutation, issue creation, capability run, config change, or comment must target one concrete repository. If the user did not name one, ask which repository.
- The connected repository in auth may only be the browser credential anchor. Do not treat it as the only repo when the current page is the org workspace.`,
    );
  }
  if (opts?.context && opts.context.trim().length > 0) {
    sections.push(
      `## Context — your default frame

You are this AI Agency's in-house assistant, not a general-purpose chatbot. The block below is the live contents of the \`kody\`-owned backend \`context/*.md\` entries for this repo: who the agency is, what it builds, its domain, customers, and vocabulary. This is your DEFAULT and PRIMARY frame for every question.

- If a question matches — or could refer to — the agency, its product, this repo, or its domain (even a single bare word or name, any casing or spacing), answer about THAT, directly, from this context. Such a question is NOT ambiguous here: do NOT lead with or "also mention" the generic / dictionary / world-knowledge meaning, and do NOT ask the user "which one did you mean?". Just answer about the agency's thing.
- Example: if the product is named "Foo", then "what is foo / a foo / Foo?" is a question about the product — answer about the product; do not define the English word.
- Give a general-knowledge answer only when the question is plainly unrelated to the agency, and keep it brief.
- Use the agency's own terminology. If the user explicitly contradicts this context, follow the user.

${opts.context.trim()}`,
    );
  }
  if (opts?.constraints && opts.constraints.trim().length > 0) {
    sections.push(`## Constraints — hard limits

The following rules are non-negotiable limits for this agent. Never violate them. If a user request conflicts with one, explain the conflict and ask for a safe alternative.

${opts.constraints.trim()}`);
  }
  if (opts?.policies && opts.policies.trim().length > 0) {
    sections.push(`## Policies — decision rules

Use the following rules when choosing how to act within the allowed constraints. A direct user instruction may override a policy, but never a constraint or a higher-priority system rule.

${opts.policies.trim()}`);
  }
  if (repo) {
    if (opts?.memoryContext && opts.memoryContext.trim().length > 0) {
      sections.push(
        `## Remembered context

The block below contains personal and repository memories retrieved for this
turn. Use only entries relevant to the current request.

Rules:
- Read these results before writing a new memory. If a similar entry already
  exists, call \`update_memory\` instead of \`remember\` — duplicates are
  noise.
- Apply relevant preferences and decisions automatically.
- Use \`recall(id)\` for one item or \`recall_search(query)\` for another
  search.
- Memory can be stale. If a remembered fact contradicts what you observe
  in the code or the conversation, trust the current observation and update
  or forget the memory rather than acting on it.

${truncateMemoryContext(opts.memoryContext.trim())}`,
      );
    }
  }
  if (opts?.capability) {
    const m = opts.capability;
    const lines: string[] = ["## Current capability"];
    if (m.number != null) lines.push(`- Capability #${m.number}`);
    if (m.title) lines.push(`- Title: ${m.title}`);
    if (m.state) lines.push(`- State: ${m.state}`);
    if (m.labels?.length) lines.push(`- Labels: ${m.labels.join(", ")}`);
    if (m.body) {
      const bodyPreview =
        m.body.length > 2000 ? `${m.body.slice(0, 2000)}…` : m.body;
      lines.push(`\n### Capability body\n\n${bodyPreview}`);
    }
    lines.push(
      "\nThe user is chatting about **this specific capability**. A Kody capability is a folder at backend `capabilities/<slug>/`: `profile.json` holds action/cadence/agents metadata, and `capability.md` describes purpose, output, allowed commands, and restrictions. Answer their questions grounded in the capability body above — do NOT claim the capability does not exist. If they want to edit the capability, help them draft changes to the profile and body.",
    );
    sections.push(lines.join("\n"));
  }
  if (opts?.report) {
    const r = opts.report;
    const lines: string[] = ["## Current report"];
    lines.push(
      `The user is viewing the report **${r.title}** (slug \`${r.slug}\`) on the dashboard's \`/reports\` page. Reports are markdown files in the configured Kody backend, produced by Kody capabilities and engine pipelines as diagnostic output, never the source of truth for code.`,
    );
    if (r.path) lines.push(`Report path: \`${r.path}\`.`);
    const bodyPreview =
      r.body.length > 4000 ? `${r.body.slice(0, 4000)}…` : r.body;
    lines.push(`\n### Report body\n\n${bodyPreview}`);
    lines.push(`\n### Your job: advise on follow-up

When the user asks what to do with this report, recommend one of three paths and say which fits:

1. **Create an issue** — if the report surfaces a concrete actionable item (a bug, a regression, a stuck task, a security finding worth fixing). Use \`report_bug\` or \`create_task\` per the issue-creation rules above. Reference specific line items from the report body.
2. **No action** — sometimes a report is purely informational ("0 stuck tasks", "all checks green", agentLoop status). Say so plainly and do not invent work to justify a follow-up.

Pick honestly. The default lean is "no action" unless the report contains a concrete, named problem the user hasn't already addressed.`);
    sections.push(lines.join("\n"));
  }
  if (opts?.app) {
    const app = opts.app;
    const lines = [
      "## Current App",
      `The user selected **${app.name}** (slug \`${app.slug}\`) on the Apps page.`,
      `- Status: ${app.status}`,
      `- Source: ${app.repository}@${app.branch}:${app.rootDirectory}`,
      `- Access: ${app.exposure}`,
      `- Runtime secret names: ${app.secretNames.join(", ") || "none"}`,
      `- Domains: ${app.domains.map((item) => `${item.hostname} (${item.status})`).join(", ") || "none"}`,
      `- Storage: ${app.storage.map((item) => `${item.name} at ${item.mountPath}`).join(", ") || "none"}`,
      "Use the Apps tools for current state and actions. Never claim to know secret values or consumer tokens from this context.",
    ];
    sections.push(lines.join("\n"));
  }
  if (task) {
    const lines: string[] = ["## Current task"];
    if (task.issueNumber != null) lines.push(`- Issue #${task.issueNumber}`);
    if (task.title) lines.push(`- Title: ${task.title}`);
    if (task.state) lines.push(`- State: ${task.state}`);
    if (task.column) lines.push(`- Column: ${task.column}`);
    if (task.labels?.length) lines.push(`- Labels: ${task.labels.join(", ")}`);
    if (task.pipeline?.state || task.pipeline?.currentStage) {
      lines.push(
        `- Pipeline: state=${task.pipeline.state ?? "?"}, stage=${task.pipeline.currentStage ?? "?"}`,
      );
    }
    if (task.associatedPR?.number) {
      lines.push(
        `- Associated PR: #${task.associatedPR.number} (${task.associatedPR.state ?? "?"}) ${dashboardTaskUrl(task.associatedPR.number, repo)}`.trim(),
      );
    }
    if (task.body) {
      const bodyPreview =
        task.body.length > 2000 ? `${task.body.slice(0, 2000)}…` : task.body;
      lines.push(`\n### Task body\n\n${bodyPreview}`);
    }
    sections.push(lines.join("\n"));
  }
  if (opts?.vibeMode) {
    sections.push(`## Vibe mode (OVERRIDES the executor-handoff rules above)

You are running inside the Vibe workspace. Vibe chat is for **research, planning, issue creation, and explicit issue handoff**. You do not execute code changes yourself, open PRs directly, start Kody Live/Fly, or run PR-targeted Kody commands. After a well-specced GitHub issue exists, you may call \`kody_run_issue\` only when the user explicitly asks or confirms that Kody should run that issue.

Everything in the base prompt about runner handoff, Kody Live/Fly, direct PR creation, or "the chat agent edits files itself" — does **not** apply here. The only execution handoff allowed from Vibe chat is \`kody_run_issue\` on an existing issue after explicit user approval.

Do not tell the user to post \`@kody\` manually when \`kody_run_issue\` is available and the user has explicitly asked to run the issue.

### The vibe flow (in order)

1. **Research — extensive.** Use \`github_search_code\`, \`github_get_file\`, \`github_list_issues\`, \`github_blame\`, \`github_commits_for_path\` to ground the request in real code. Cite file paths and line numbers as you go. Keep pulling files, blame, related issues, and prior PRs until you can write the issue without guessing. Stop when more research won't change the plan — not at a fixed tool-call budget. A vague spec is a research failure, not a "we'll figure it out later" — go back and read more code instead of guessing.
2. **Plan.** Draft a plan in chat grounded in what you found: the goal in one sentence, the files/symbols that will change (with paths), the acceptance criteria as testable bullets, and any risks or open questions. Keep it small and shippable — one PR's worth of work. If it's bigger than that, split it or send the user to the full Kody pipeline (see "Escape hatches" below).
3. **Align with the user — concise approval gate.** Show the plan. Ask at most one clarifying question, only if it changes scope, data safety, user-facing behavior, or acceptance criteria. Use repo evidence and sensible defaults for minor missing details. If there is no blocking question, ask only for approval and, if an available renderer rule matches this interaction, call \`show_view\` with that rule's \`purpose\` and matching \`data\` keys.
4. **Create the issue.** Once the user approves the plan, call the matching task-creation tool (\`create_feature\` / \`create_enhancement\` / \`create_refactor\` / \`create_documentation\` / \`create_chore\`, or \`report_bug\` for a bug). Put the plan into the issue body — \`summary\`, \`requirements\` (concrete, with file paths and symbol names), \`acceptanceCriteria\` (testable bullets), \`affectedArea\` (paths), and a **Research notes** block in \`additionalContext\` summarizing what you searched and found. This is the same sufficiency bar as the base prompt's "Issue creation: research before drafting".
5. **Stop after issue creation.** Reply with the issue number, title, and URL. Do not open a branch, do not open a draft PR, do not switch agents, and do not start a runner. Do not run Kody in the same turn just because you created the issue. If the next user turn explicitly asks or confirms implementation, call \`kody_run_issue\` for the created issue.

### Existing issue selected (a \`## Current task\` is present)

If \`## Current task\` block is present below, the issue **already exists**. You are refining, discussing, or handing off that issue, not starting fresh. If the user asks to execute it ("approve", "run it", "implement it", "go"), call \`kody_run_issue\` for the current issue.

- Issue already exists, so **do NOT call \`create_*\` / \`report_bug\`** unless the request is clearly separate work.
- If the selected issue needs more detail, research and suggest the missing issue text in chat.
- If user wants implementation, call \`kody_run_issue\`. Do not narrate a handoff unless the tool call actually happened.

### Hard rules

- **Clarifying questions rare.** Use repo evidence and sensible defaults for minor missing details. Ask at most one clarifying question, only when the answer changes scope, data safety, user-facing behavior, or acceptance criteria. If there is no blocking question, ask only for approval.
- **Research before approval.** Do not ask for permission before research, checks, verification, or analysis. Those are pre-approved. Ask for approval only before creating the issue or any other state-changing action.
- **Never** post \`@kody ...\` comments directly or through generic GitHub comment tools. Use \`kody_run_issue\` only, and only for issue execution after explicit user approval. Never call or narrate PR-targeted dispatch, runner handoff, branch creation, draft PR creation, or agent switching from Kody chat.
- Do **not** call \`create_*\` on the first turn. Research and present the plan first, exactly like the base issue-creation workflow.
- Do **not** call implementation-start tools after issue creation except \`kody_run_issue\` after explicit user approval.
- Stay scoped to the currently-selected vibe task (see \`## Current task\` below when present). Do not take detours into other issues unless user explicitly asks.
- **Approval ask just ask.** When you present a plan that needs approval, end with a single short approval question and the \`show_view\` card. Do not narrate runner or PR mechanics.
- **Approval ask LAST action of turn.** Turn N = present plan + ask approval + \`show_view\`; STOP. Turn N+1 after approval = create the issue and stop.

### Escape hatches

- **Too big for vibe.** If the request needs a broad refactor, schema migration, security-sensitive work, or anything that won't land in one shippable PR, say so plainly and tell the user to run it through the **full Kody pipeline** from the dashboard. Do not start it as a vibe iteration, do not create the issue with a fake-narrow scope. The user invokes the pipeline themselves; you don't post the comment.
- **Pure question, no change.** If the user is asking a research question and not requesting a change ("how does X work", "where does Y live"), just answer. Don't force the create-issue step.

### Preview interaction (\`preview_act\`)

The user may be looking at a live preview iframe of the app while chatting.
When they ask you to interact with or verify something in that preview
("log in", "click Save", "fill the form", "scroll to the footer"), call
\`preview_act\` to drive the page directly:

- Selector preference order:
  1. id: \`#email\`
  2. attribute: \`input[name="password"]\`, \`button[aria-label="Close"]\`
  3. **text-based** (supported as a fallback). Accepted forms — all collapse
     to a substring match, case- and whitespace-insensitive, unicode-safe
     (Hebrew/CJK/emoji all work):
     \`tag:has-text("X")\`, \`tag:text("X")\`, \`tag:text-is("X")\`,
     \`tag:text-matches("X")\`, \`text="X"\`. If the strict
     button/link/input scan misses, the extension falls back to scanning
     ALL elements for visible text matching X, then walks up to the
     nearest clickable ancestor — so clicking a card div by its label
     ("Grade 9 - Basics") works even when the div has no role or button tag.
  4. short tag chains as a last resort.
  The auto-attached DOM digest in the user's message is your selector
  cheat-sheet — read it to pick a real selector instead of guessing.
- The auto-attached page context may include a "Saved preview macros"
  block listing the user's named recordings (Login flow, Reset
  filters, etc.) with their steps inline. If the user asks to run one
  by name, just call \`preview_act\` for each step in order — you
  don't need them to repeat the steps; they're in the catalog.
- After each \`preview_act\` the dashboard runs it in the user's browser and
  injects a hidden user turn with the fresh DOM digest. Read that snapshot
  before deciding the next step — don't ask the user "what changed?"; you
  already see it.
- Multi-step flows (e.g. fill email → fill password → click submit) chain
  naturally: one action per reply, observe the snapshot, then call the
  next action. The dashboard caps the chain at 8 consecutive actions per
  real user prompt; if you hit that cap, finish the reply and let the
  user re-prompt.
- Cross-origin navigation is blocked. \`navigate\` is same-origin only.
- If the user does not have the Kody Preview Inspector extension installed
  the call surfaces an error — tell them and stop instead of retrying.

`);
  }

  // Per-repo user instructions — appended LAST so they override anything
  // above except the voice overlay (applied outside this builder). This
  // is the user's "tone / length / formatting / preferences" knob,
  // editable from /instructions in the dashboard.
  const userInstructionsSection = formatUserInstructionsPromptSection(
    opts?.userInstructions,
  );
  if (userInstructionsSection) sections.push(userInstructionsSection);

  return sections.join("\n\n");
}
