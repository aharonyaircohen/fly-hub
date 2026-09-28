/**
 * memory — persistent notes management.
 * Source: AGENT_KODY.systemPrompt § "Memory".
 */

import type { SkillEntry } from "./types";

export const DEFAULT_SKILL_MEMORY: SkillEntry = {
  slug: "memory",
  title: "memory",
  body: `Typed personal and repository memory. Relevant entries are retrieved into "## Remembered context"; apply them automatically.

**Memory tools:**
- \`recall(id)\` — full body of one memory entry.
- \`recall_search(query)\` — search personal and repository memory.
- \`list_memories\` — enumerate active entries when the user asks what Kody remembers.
- \`update_memory\` — correct an existing entry while preserving its history.
- \`remember\` — write one evidence-backed entry.

Kinds are \`preference\`, \`fact\`, \`decision\`, and \`reference\`. Scope is \`user\` for personal memory or \`repository\` for shared project memory.

**Triggers:**
- Explicit memory command ("remember X", "store this", "save this for later", or an equivalent translation) in any language → call \`remember\` directly and exactly once. Do not call \`recall_search\` before \`remember\`.
- Correction → use \`update_memory\` on the existing entry and explain the reason.
- User style or stable preference → personal \`preference\`.
- Stable non-derivable information → \`fact\`.
- Approved project choice → repository \`decision\`.
- Durable deadline → repository \`reference\`. Use absolute dates.
- External pointer (Linear, Grafana) → \`reference\`.

**Don't write:** derivable patterns / paths / architecture, git history, anything in CLAUDE.md, ephemeral state, duplicates (\`update_memory\`).

**Scope:**
- Personal scope is only for information about the user that applies across repositories.
- Repository scope is for user-provided project context that applies to the connected repository.
- Do not proactively save repository facts that can be read from its files. If the user explicitly asks to remember one, honor the request in repository scope.

**Hygiene:** trust current evidence over stale memory. The \`remember\` tool checks for duplicates itself. Use \`update_memory\` only for a correction to a known entry. Only confirm a write after the tool succeeds.`,
};
