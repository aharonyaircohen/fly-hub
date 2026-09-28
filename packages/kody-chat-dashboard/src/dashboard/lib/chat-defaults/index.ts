/**
 * @fileType util
 * @domain kody
 * @pattern chat-defaults-loader
 *
 * Composes the Kody chat system prompt from a structured bundle:
 *
 *   agentIdentity (who the agent is)
 *   + capability (kody-chat) → glue + skill index
 *   + workflows (kody-analyzer, kody-operator, kody-vibe, kody-mem) → workflow index
 *   + skills (diagnose-pr, report-advise, todo-planner, create-issue, …) → reusable method
 *
 * Product-owned defaults are embedded and versioned with the Dashboard.
 */

import {
  DEFAULT_IDENTITY_MD,
  FOLLOW_UP_QUESTION_CONTRACT,
  DEFAULT_CHAT_CAPABILITY,
  DEFAULT_WORKFLOWS,
  DEFAULT_SKILLS,
  type ChatWorkflowEntry,
  type ChatCapabilityEntry,
  type SkillEntry,
} from "./defaults";

export { FOLLOW_UP_QUESTION_CONTRACT } from "./defaults";

export interface ChatDefaults {
  /** Base agentIdentity text — who the agent is, hard rules, style. */
  agentIdentity: string;
  /** The single chat capability (kody-chat) and its config. */
  capability: ChatCapabilityEntry;
  /** Chat workflow groupings (analyze / operator / vibe / mem). */
  workflows: ChatWorkflowEntry[];
  /** Skills keyed by slug — reusable method per workflow. */
  skills: Record<string, SkillEntry>;
}

/**
 * Load the product-owned chat defaults bundle.
 */
export async function loadChatDefaults(
  _owner?: string,
  _repo?: string,
): Promise<ChatDefaults> {
  return {
    agentIdentity: DEFAULT_IDENTITY_MD,
    capability: DEFAULT_CHAT_CAPABILITY,
    workflows: DEFAULT_WORKFLOWS,
    skills: DEFAULT_SKILLS,
  };
}

/**
 * Compose the chat system prompt from the bundle + per-mode runtime
 * blocks. Step 1 mirrors the existing `buildSystemPrompt` shape so the
 * refactor is provably equivalent to the hardcoded version.
 *
 * The runtime-mode blocks (Current task / Current capability / Current report /
 * Mission planning mode / Vibe mode) are composed by the existing
 * `buildSystemPrompt` in `app/api/kody/chat/kody/system-prompt.ts` and
 * stay there — they're runtime state, not authorable content.
 */

/**
 * Compose only the bundle portion of the prompt: agentIdentity + workflows +
 * skills (+ optional tool index). This is the `base` arg passed into
 * the existing `buildSystemPrompt`, which then layers the runtime-mode
 * blocks (Connected repository, Current page, Context, Memory, Current
 * task, Current capability, Current report, Mission planning, Vibe mode, User
 * instructions) on top.
 */
export function composeBasePrompt(
  bundle: ChatDefaults,
  opts?: {
    /**
     * Pre-formatted `## Tool index` block — every callable tool's
     * name + description, one per line. Injected between the Skills
     * section and the runtime blocks so the model can see what each
     * tool does before it gets the per-turn context. Pass the output
     * of `buildToolIndex(allowlistedTools)`.
     */
    toolIndex?: string | null;
  },
): string {
  const parts: string[] = [];

  // 1. AgentIdentity — who the agent is (hard rules + tool policy).
  parts.push(bundle.agentIdentity.trim());

  // 2. Workflows — the 4 workflow wrappers, each listing the skills it owns.
  parts.push("## Workflows");
  for (const workflow of bundle.workflows) {
    parts.push(`### ${workflow.title}\n\n${workflow.body.trim()}`);
  }

  // 3. Skills — reusable method per workflow.
  parts.push("## Skills");
  for (const skill of Object.values(bundle.skills)) {
    parts.push(`### ${skill.title}\n\n${skill.body.trim()}`);
  }

  // 4. Tool index (optional) — name + description of every callable.
  // Drastically improves tool selection accuracy. The model has 90+
  // tools to pick from; without descriptions it guesses by name and
  // often picks the wrong one (or claims a tool doesn't exist).
  if (opts?.toolIndex && opts.toolIndex.trim().length > 0) {
    parts.push(
      `## Tool index\n\nThe block below lists every callable tool the chat can invoke right now, one per line, with a one-sentence description of what each does. Use it to pick the right tool for the question. If none fits, say so — do not call a tool whose description doesn't match the question.\n\n${opts.toolIndex.trim()}`,
    );
  }

  return parts.join("\n\n");
}

/**
 * Build a `## Tool index` block from the allowlisted tool set. Each
 * tool's `description` field (set by the author via the AI SDK's
 * `tool({...})` call) is the single source of truth for what the
 * tool does. The route already builds this map for the thinking-panel
 * UI; this helper produces the prompt-formatted version.
 */
export function buildToolIndex(tools: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [name, t] of Object.entries(tools)) {
    const desc =
      t && typeof t === "object" && "description" in t
        ? (t as { description?: unknown }).description
        : undefined;
    if (typeof desc === "string" && desc.trim().length > 0) {
      // Trim to the first sentence or first ~240 chars (whichever is
      // shorter) — full descriptions can run 1-2KB each; the model
      // only needs the first line to pick the right tool.
      const trimmed = truncateToFirstSentence(desc.trim(), 240);
      lines.push(`- \`${name}\` — ${trimmed}`);
    } else {
      lines.push(`- \`${name}\``);
    }
  }
  return lines.join("\n");
}

function truncateToFirstSentence(text: string, maxLen: number): string {
  // Find the first sentence boundary (., !, ?, or newline) followed by
  // whitespace or end-of-string.
  const match = text.match(/^[\s\S]*?[.!?](?:\s|$)/);
  const first = match ? match[0].trim() : text;
  if (first.length <= maxLen) return first;
  return `${first.slice(0, maxLen).trimEnd()}…`;
}

/**
 * The end-of-prompt reminder block. Appended after `buildSystemPrompt`
 * returns and before the voice overlay so the model sees it last among
 * the static rules (recency bias). Re-states the critical rules in
 * compact form so the model holds them through the runtime blocks.
 */
export const CRITICAL_REMINDERS_MD = `## Critical reminders

These apply every turn. They protect correctness without changing the reply contract.

- **Start with the answer.** Final replies begin with one plain, high-level answer that explains the effect, not the mechanism.
- **Read repo before answering.** Any question that touches the repo (what/where/why/how something works, "does X exist", "is this good", "review this", "should we", "can we", "analyze", "audit", "find bugs", "investigate", "scan", "where is Y used", "why was X written", "what changed", "create/file/open an issue") → call a read tool FIRST. Never answer from training or conversation alone.
- **Research does not need approval.** Research, checking, verification, and analysis are pre-authorized. Ask for confirmation only before state-changing actions.
- **Workflow routing.** Discover active workflows with \`list_workflows\`, inspect the selected definition with \`read_workflow\`, and execute it with \`run_workflow\`; never hardcode a request phrase to a workflow ID.
- **Verify before claiming.** Before stating something exists in the repo (a label, file path, function, env var, workflow, config key — anything factual), call a read tool to confirm. If you can't verify, say so. Inventing facts is worse than admitting uncertainty.
- **No fabrication.** Never invent file paths, file contents, issue/PR numbers, SHAs, or tool results.
- **CMS source truth.** CMS chat tools use the same Dashboard CMS service and configured collection adapter as Content Entries. Do not claim they use a different CMS source unless a tool result proves a specific collection is configured differently.
- **Cite your evidence.** Every claim about the repo gets a \`file:line\` citation from a tool result THIS turn. "No matches for X" is a valid finding — say so explicitly.
- **Contextual follow-up.** ${FOLLOW_UP_QUESTION_CONTRACT}
- **No sycophantic openers.** Start with the answer. "Great question", "Sure!", "Of course", "Absolutely", "Happy to help", and "Certainly" are all banned.
- **Short, PM-grade answers.** The final answer is an executive summary: a few short sentences describing outcome and decision, at most one small list. Never paste raw JSON, schemas, code, id lists, or intermediate work into the answer unless the user explicitly asked to see them — reference where they live instead. Working data belongs in tool calls, not the reply.
- **Narration is user-visible.** Every character you write outside a tool call streams straight into the user's chat, verbatim. Between tool calls write at most ONE short progress sentence ("Creating the lesson…"), or nothing. Never write plans, schemas, JSON, ids, drafts, or interim reports as loose text — the user sees all of it and it buries your answer.`;

/**
 * Filter a tool set down to the names declared in the bundle's
 * capability `tools` allowlist. If the allowlist is empty, the tool
 * set passes through unchanged (default = everything).
 */
export function filterToolsByAllowlist(
  tools: Record<string, unknown>,
  allowlist: string[],
): Record<string, unknown> {
  if (allowlist.length === 0) return tools;
  const allowed = new Set(allowlist);
  const filtered: Record<string, unknown> = {};
  for (const [name, impl] of Object.entries(tools)) {
    if (allowed.has(name)) filtered[name] = impl;
  }
  return filtered;
}

export function composeChatPrompt(
  bundle: ChatDefaults,
  sections: {
    /** Connected repo block, null if not connected. */
    repo: { owner: string; repo: string } | null;
    /** Current page noun phrase, null if not on a dashboard page. */
    currentPage?: string | null;
    /** Company context block from Convex `context/*.md`. */
    context?: string | null;
    /** Memory index from Convex `memory/INDEX.md`. */
    memoryContext?: string | null;
    /** Names only; credentials never enter the model prompt. */
    connectedRepositories?: Array<{ owner: string; repo: string }>;
  },
): string {
  const parts: string[] = [composeBasePrompt(bundle)];

  // Connected repo.
  if (sections.repo) {
    parts.push(
      `## Connected repository\n\nYou are helping the user with the repository **${sections.repo.owner}/${sections.repo.repo}**. When the user refers to "the repo", "this repo", "the codebase", or a file path, they mean this repository. Ground your answers in the conversation context the user provides — do not invent file contents or PR numbers you haven't seen.`,
    );
  }

  if (sections.connectedRepositories?.length) {
    parts.push(
      `## Connected repositories\n\nThese repositories are connected to the signed-in account. The current repository remains the default, but explicit source and target names must be preserved for cross-repository work.\n\n${sections.connectedRepositories
        .map(
          (repository) =>
            `- ${repository.owner}/${repository.repo}${
              sections.repo?.owner.toLowerCase() ===
                repository.owner.toLowerCase() &&
              sections.repo.repo.toLowerCase() === repository.repo.toLowerCase()
                ? " (current)"
                : ""
            }`,
        )
        .join("\n")}`,
    );
  }

  // Current page.
  if (sections.currentPage && sections.currentPage.trim().length > 0) {
    parts.push(
      `## Current page\n\nThe user is currently viewing **${sections.currentPage.trim()}** in the dashboard. When they say "this page", "here", "what am I viewing", or "what is this", they mean this page — answer about it directly. Use your dashboard knowledge to describe it (call \`describe_feature\` with the matching id, e.g. the page slug, when you need the full rundown).`,
    );
  }

  // Context — agency/agentIdentity default frame.
  if (sections.context && sections.context.trim().length > 0) {
    parts.push(
      `## Context — your default frame\n\nYou are this AI Agency's in-house assistant, not a general-purpose chatbot. The block below is the live contents of the \`kody\`-owned Convex \`context/*.md\` entries for this repo: who the agency is, what it builds, its domain, customers, and vocabulary. This is your DEFAULT and PRIMARY frame for every question.\n\n- If a question matches — or could refer to — the agency, its product, this repo, or its domain (even a single bare word or name, any casing or spacing), answer about THAT, directly, from this context. Such a question is NOT ambiguous here: do NOT lead with or "also mention" the generic / dictionary / world-knowledge meaning, and do NOT ask the user "which one did you mean?". Just answer about the agency's thing.\n- Example: if the product is named "Foo", then "what is foo / a foo / Foo?" is a question about the product — answer about the product; do not define the English word.\n- Give a general-knowledge answer only when the question is plainly unrelated to the agency, and keep it brief.\n- Use the agency's own terminology. If the user explicitly contradicts this context, follow the user.\n\n${sections.context.trim()}`,
    );
  }

  // Todo guidance + memory index (only when a repo is connected).
  if (sections.repo) {
    parts.push(
      `## Todos and Agency management\n\nUse the Agency tools to manage the same data shown by the Dashboard. Workflows, Agents, Capabilities, Todos, Loops, and Intents can be listed, read, saved, and removed through their named tools; only runnable items can run. Store items are detached from this repo rather than deleted from the Store. Agency Runs are immutable and may only be listed or read.`,
    );
    if (sections.memoryContext && sections.memoryContext.trim().length > 0) {
      parts.push(
        `## Remembered context\n\nThe memories below were retrieved for this turn from personal and repository memory.\nUse them when relevant. Avoid duplicates: correct an existing memory instead of creating another.\nMemory can be stale; current code and explicit user corrections take priority.\nUse \`recall(id)\` for one item or \`recall_search(query)\` for another search.\n\n${sections.memoryContext.trim()}`,
      );
    }
  }

  // Capability glue — the kody-chat wrapper text + tools index.
  parts.push(
    `## Tools available\n\nThe block below is the live contents of the chat capability's \`tools\` allowlist. Use only the tools listed.\n\n${bundle.capability.tools.map((t) => `- \`${t}\``).join("\n")}`,
  );

  return parts.join("\n\n");
}

export type { ChatWorkflowEntry, ChatCapabilityEntry, SkillEntry };
