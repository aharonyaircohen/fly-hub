/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Lets the assistant answer "what is X in the dashboard?" without
 *  guessing from training data. Static feature catalog + auto-derived entries
 *  for every agent in src/dashboard/lib/agents.ts AND every page in the shared
 *  settings-nav sidebar, so descriptions never drift and new pages teach chat
 *  about themselves automatically.
 */
import { tool } from "ai";
import { z } from "zod";
import {
  AGENTS,
  type AgentConfig,
} from "../../../../../src/dashboard/lib/agents";
import { slugifyTitle } from "@kody-ade/base/slug";
import {
  HOME_NAV_ITEM,
  PRIMARY_NAV_ITEMS,
  PRIMARY_NAV_TITLE,
  SETTINGS_NAV_SECTIONS,
  type SettingsNavItem,
} from "../../../../../src/dashboard/lib/feature-catalog";
import { getFeatureGuideRegistry } from "../../../../../src/dashboard/lib/chat/platform/server-feature-guides";

export interface FeatureEntry {
  id: string;
  name: string;
  summary: string;
  details: string;
}

const HAND_WRITTEN_FEATURES: FeatureEntry[] = [
  {
    id: "secrets-vault",
    name: "Secrets Vault (/secrets)",
    summary:
      "Per-repo encrypted secrets store. Dashboard-managed alternative to Vercel env vars.",
    details: `The secrets vault is a dashboard-managed alternative to Vercel env vars.

- Each connected repo has its own encrypted Convex document at \`secrets.enc\`.
- Values written via the \`/secrets\` page are AES-256-GCM-encrypted with the shared
  \`KODY_MASTER_KEY\` env var before storage.
- Runtime code reads values via \`getSecret\` (src/dashboard/lib/vault/get-secret.ts),
  which falls through to \`process.env\` when the vault is missing.
- Bootstrap with \`pnpm vault:init\` to print a fresh key, then paste it into the
  Vercel env. Losing the key means re-entering every secret.
- Engine workflows authenticate to Dashboard with GitHub OIDC and request only
  the secret names needed by the selected capability and model.`,
  },
  {
    id: "webhooks",
    name: "GitHub Webhooks (push-based cache invalidation)",
    summary:
      "Replaces polling for cache invalidation. No shared secret — verifies GitHub IP CIDR ranges.",
    details: `The dashboard receives GitHub webhooks to invalidate its in-memory cache when
issues, PRs, workflow runs, branches, etc. change.

- No shared secret: the receiver verifies the source IP against GitHub's published
  webhook CIDR ranges (cached 24h from \`api.github.com/meta\`). Other sources 403.
- Receiver: \`app/api/webhooks/github/route.ts\` dedupes by \`X-GitHub-Delivery\`
  and dispatches to the matching invalidator.
- Registrar: \`ensureWebhook\` is auto-called from the OAuth callback after login
  (fire-and-forget) and is idempotent.
- Manual re-register: \`POST /api/webhooks/register\`.
- Events: issues, issue_comment, pull_request, pull_request_review,
  pull_request_review_comment, workflow_run, workflow_job, check_run,
  check_suite, push, create, delete.
- Invalidation is per-Vercel-instance — other instances serve cached data until
  their TTL expires (intentional, as a backstop).`,
  },
  {
    id: "chat-backends",
    name: "Chat Backends (three of them)",
    summary:
      "The dashboard has three chat backends picked by selectedAgentId: in-process via Vercel AI Gateway (default), Brain, and the GH Actions engine.",
    details: `The chat UI routes to one of three backends based on \`selectedAgentId\`:

| selectedAgentId | Endpoint                       | Backend                                            |
|-----------------|--------------------------------|----------------------------------------------------|
| \`kody\` (default) | \`/api/kody/chat/kody\`        | In-process via @ai-sdk/gateway (Vercel AI Gateway) |
| \`brain\`         | \`/api/kody/chat/brain\`       | External Brain chat server (proxied SSE)           |
| anything else   | \`/api/kody/chat/trigger\`     | GitHub Actions + \`@kody-ade/kody-engine\`         |

The legacy \`/api/kody/chat\` endpoint is deprecated and returns 410.

Engine path details: dispatches \`kody.yml\` in the connected repo with the
session ID and an inline HMAC token. The engine streams events back to
\`/api/kody/events/ingest\` (real-time) and commits them to
backend \`events/{sessionId}.jsonl\` (durable fallback, polled by
\`/api/kody/events/stream\`). Token verified via HMAC of sessionId with
\`KODY_MASTER_KEY\` (purpose-prefixed as \`kody-chat-token:\${KODY_MASTER_KEY}\`).`,
  },
  {
    id: "pipeline-stages",
    name: "Kody Pipeline Stages",
    summary:
      "Spec phase: taskify → spec → clarify. Impl phase: architect → plan-review → build → commit → verify → pr. Special: autofix retry loop.",
    details: `The Kody pipeline runs in GitHub Actions and has these stages:

**Spec phase**
- \`taskify\` — turn an issue into a structured task
- \`spec\` — write the spec
- \`clarify\` — ask blocking clarification questions

**Impl phase**
- \`architect\` — design the technical approach
- \`plan-review\` — review the plan
- \`build\` — implement
- \`commit\` — commit changes
- \`verify\` — run tests / type checks
- \`pr\` — open the pull request

**Special**
- \`autofix\` — retry loop for failing CI

Each stage's status is committed to a per-task \`status.json\` on the work branch.`,
  },
  {
    id: "kody-capabilities",
    name: "Kody Capabilities",
    summary:
      "Current storage folders at backend capabilities/<slug>/ that define capability contracts.",
    details: `A Kody Capability is stored at backend \`capabilities/<slug>/\`:

- \`profile.json\` stores execution settings, tools, skills, and scripts.
- \`capability.md\` stores the human-readable instructions and restrictions.

Intent owns why. Loop owns when to check. Agent owns who acts. Capability owns
what can be run.

Format (must match existing capabilities in backend \`capabilities/\`):
- \`profile.json\` metadata
- \`capability.md\` with clear instructions
- \`## Restrictions\`

The capability defines the run contract. Ownership, schedule, and loops stay
outside the capability.

Do not put metadata or raw state keys in \`capability.md\`. Runtime state stays
engine-owned.

The chat exposes \`read_capability_creation_guide\` and \`create_or_update_capability\` to
scaffold a new capability after a gap-analysis conversation. Never call it on
the first turn; show the proposed profile and instructions for approval first.`,
  },
  {
    id: "kody-agent",
    name: "Kody Agent (reusable agent files)",
    summary:
      "Markdown files at backend agents/<slug>.md — pure reusable agent identities.",
    details: `A Kody Agent member is a markdown file at backend \`agents/<slug>.md\`. A
agent is a pure reusable identity — a markdown body describing intent,
allowed commands, and restrictions. Agents have NO schedule, NO state,
and NO run/tick; they're agent identities referenced by other flows. The Agent
page is a pure agentIdentity editor (list / view / create / edit / delete).

Format (must match existing agent in backend \`agents/\`):
- H1 title
- \`## Agent\` — purpose / agentIdentity
- \`## Allowed Commands\`
- \`## Restrictions\`

The chat exposes the \`create_kody_agent\` tool to scaffold a new agent
agentIdentity after a gap-analysis conversation.`,
  },
  {
    id: "memory",
    name: "Persistent Memory System",
    summary:
      "Typed personal and repository memory with relevant retrieval and revision history.",
    details: `Kody stores typed memory in Convex.

- Scopes: personal user memory and shared repository memory.
- Kinds: \`preference\`, \`fact\`, \`decision\`, \`reference\`.
- Relevant entries are retrieved for each chat turn under "## Remembered context".
- Corrections create immutable revisions with evidence and reasons.

Chat tools:
- \`remember\` — write a new entry
- \`update_memory\` — revise one
- \`forget\` — delete one
- \`recall(id)\` — fetch the full body when the one-line hook isn't enough
- \`recall_search(query)\` — search personal and repository memory
- \`list_memories\` — enumerate all of them

Kody must avoid duplicates, preserve corrections as revisions, and delete only
when the user explicitly asks to forget an entry.`,
  },
  {
    id: "task-dashboard",
    name: "Task Dashboard (main page)",
    summary:
      "Lists Kody tasks, pipeline stage progress, and associated PRs/workflow runs.",
    details: `The main dashboard page lists Kody tasks driven by GitHub issues.

- Each task row shows pipeline stage progress, the latest workflow run, and any
  linked PR.
- Cache invalidation is push-driven via webhooks (see \`webhooks\` feature).
- Polled endpoints respect strict GitHub rate-limit rules (see CLAUDE.md):
  the polling token is shared across all dashboard users (5000 REST req/hr),
  so cache misses must go through ETag/\`If-None-Match\` and writes must call
  \`invalidateIssueCache(n)\`.
- Polling cadence is ≥ 15s on every endpoint that touches GitHub.`,
  },
  {
    id: "remote-dev",
    name: "Remote Dev (user's own Mac)",
    summary:
      "Optional: lets Kody run shell, read, write, and ls on the user's remote Mac dev machine.",
    details: `When a user has configured a remote dev environment, the chat exposes four
extra tools that run against the user's own Mac:

- \`remote_implementation\` — shell commands (30s timeout, 512KB output cap)
- \`remote_read\` — read file contents (1MB limit)
- \`remote_write\` — write files (destructive — assistant must confirm first)
- \`remote_ls\` — list directory contents

Commands run with the user's local permissions. The assistant always confirms
before destructive operations.`,
  },
  {
    id: "brand-chat-access",
    name: "Brand Chat delegated client access",
    summary:
      "Lets an external application keep its own login and launch a tenant-scoped branded Kody Chat session.",
    details: `Brand Chat consumes identity; it does not provide login or own the host application's business data.

**External host launch**
- Configure the repository brand with \`access.mode: delegated\`.
- Configure repository variables \`CLIENT_IDENTITY_ISSUER\`,
  \`CLIENT_IDENTITY_AUDIENCE\`, and \`CLIENT_IDENTITY_JWKS_URL\`.
- The issuer and JWKS URL must share one HTTPS origin. Supported assertion
  algorithms are RS256, ES256, and EdDSA.
- The host application form-posts a short-lived JWT to
  \`POST /api/client-session/external-launch\` with \`assertion\`, \`owner\`,
  \`repo\`, and \`brandSlug\` fields.
- Required JWT claims are \`sub\`, \`aud\`, \`iss\`, \`iat\`, \`exp\`, \`jti\`,
  \`tenant_id\` (exact \`owner/repo\`), and \`brand_slug\`. The maximum launch
  lifetime is five minutes and \`jti\` is single-use.
- Kody verifies the assertion, creates a 30-minute HttpOnly session, and
  redirects to \`/client/<owner>/<repo>/<brandSlug>\`.

**Ownership boundary**
- The host application owns registration, login, users, business APIs, and
  business persistence.
- Kody owns assertion verification, the scoped Brand Chat session, Chat,
  GuidedFlow presentation, view renderers, and widget mounting.
- Widgets own their business calls and persistence. They receive opaque data
  and may use \`postToChat\`, \`sendToKody\`, and \`submitResult\`; Kody does not
  invent a host API or automatically persist widget results.
- GuidedFlows own navigation and collected step results, while the host feature
  continues to own real work and data.

Missing or invalid delegated identity fails closed. A session scoped to another
repository or brand is rejected. Do not replace this contract with a second
Kody login or put assertions in URLs.`,
  },
  {
    id: "voice-modality",
    name: "Voice Modality",
    summary:
      "Speech-to-text input + text-to-speech output layered onto the regular Kody chat. Keeps whichever agent the user picked in the dropdown — only the reply shape changes.",
    details: `Voice is a modality, not a separate agent dropdown. Toggling the mic in
KodyChat:

- Streams mic audio to a speech-to-text provider, which transcribes utterances
  into chat messages.
- Routes those messages to \`/api/kody/chat/kody\` with the user's selected
  \`agentId\` plus \`voiceMode: true\`. The server appends a voice overlay
  (no markdown, short sentences, symbols read aloud as words) to that agent's
  system prompt — so the selected agent's brain and tools stay in charge,
  only the output shape changes.
- Streams the reply text to a text-to-speech provider that speaks it back.

If a model in /models is flagged as the speech model, voice prefers it for
latency. Otherwise voice uses whichever model is currently selected for chat.`,
  },
];

function featureFromAgent(agent: AgentConfig): FeatureEntry {
  const id = `agent:${agent.id}`;
  const capabilities = agent.capabilities.length
    ? `\n\n**Capabilities**\n${agent.capabilities.map((c) => `- ${c}`).join("\n")}`
    : "";
  return {
    id,
    name: `Agent: ${agent.name}`,
    summary: agent.description,
    details: `${agent.description}${capabilities}`,
  };
}

/**
 * Nav pages whose concept is already described by a richer hand-written entry
 * above. We skip auto-deriving these so there's one canonical answer per
 * concept (the deep one wins). Keyed by exact nav href.
 */
const NAV_HREF_TO_HANDWRITTEN: Readonly<Record<string, string>> = {
  "/": "task-dashboard",
  "/secrets": "secrets-vault",
  "/capabilities": "kody-capabilities",
  "/agents": "kody-agent",
  "/brands": "brand-chat-access",
};

function kebab(label: string): string {
  return slugifyTitle(label, { allowUnderscore: false });
}

function featureFromNav(item: SettingsNavItem, section: string): FeatureEntry {
  const desc = item.description?.trim() ?? "";
  return {
    id: `page:${kebab(item.label)}`,
    name: `${item.label} (${item.href})`,
    summary: desc || `The ${item.label} page.`,
    details:
      `The ${item.label} page lives under the "${section}" group of the sidebar.\n\n` +
      `Route: \`${item.href}\`` +
      (desc ? `\n\n${desc}` : ""),
  };
}

function buildNavEntries(): FeatureEntry[] {
  const sourced: { item: SettingsNavItem; section: string }[] = [
    { item: HOME_NAV_ITEM, section: PRIMARY_NAV_TITLE },
    ...PRIMARY_NAV_ITEMS.map((item) => ({ item, section: PRIMARY_NAV_TITLE })),
    ...SETTINGS_NAV_SECTIONS.flatMap((s) =>
      s.items.map((item) => ({ item, section: s.title })),
    ),
  ];

  const seen = new Set<string>();
  const entries: FeatureEntry[] = [];
  for (const { item, section } of sourced) {
    if (NAV_HREF_TO_HANDWRITTEN[item.href]) continue; // covered by a deeper entry
    const entry = featureFromNav(item, section);
    if (seen.has(entry.id)) continue; // dedupe duplicate labels
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

function buildCatalog(): FeatureEntry[] {
  const agentEntries = Object.values(AGENTS).map(featureFromAgent);
  const navEntries = buildNavEntries();
  return [...HAND_WRITTEN_FEATURES, ...navEntries, ...agentEntries];
}

const CATALOG: ReadonlyArray<FeatureEntry> = buildCatalog();
const CATALOG_BY_ID = new Map(
  CATALOG.map((entry) => [entry.id.toLowerCase(), entry]),
);

export const listDashboardFeaturesTool = tool({
  description:
    "List every dashboard feature, page, and agent this assistant can describe. " +
    "Returns id, name, and one-line summary for each entry. Call this first when " +
    'the user asks "what can the dashboard do" or you do not know which feature ' +
    "id to pass to describe_feature.",
  inputSchema: z.object({}),
  execute: async () => {
    const guides = await getFeatureGuideRegistry().list();
    const guideEntries = guides.map(({ id, title, summary }) => ({
      id,
      name: title,
      summary,
    }));
    const guideIds = new Set(guideEntries.map((entry) => entry.id));
    return {
      features: [
        ...guideEntries,
        ...CATALOG.filter((entry) => !guideIds.has(entry.id)).map(
          ({ id, name, summary }) => ({ id, name, summary }),
        ),
      ],
    };
  },
});

export const describeFeatureTool = tool({
  description:
    "Return the full description of one dashboard feature (page, agent, vault, " +
    'webhooks, pipeline, etc.). Use when the user asks "what is X?", "how does X ' +
    'work?", or "what can <agent> do?". Call list_dashboard_features first if you ' +
    "do not know the exact id.",
  inputSchema: z.object({
    id: z
      .string()
      .min(1)
      .describe(
        'Feature id from list_dashboard_features (e.g. "secrets-vault", ' +
          '"webhooks", "agent:kody-live"). Case-insensitive.',
      ),
  }),
  execute: async ({ id }) => {
    const guide = await getFeatureGuideRegistry().read(id.toLowerCase());
    if (guide) {
      return {
        id: guide.id,
        name: guide.title,
        summary: guide.summary,
        details: guide.body,
      };
    }
    const entry = CATALOG_BY_ID.get(id.toLowerCase());
    if (!entry) {
      return {
        error: `Unknown feature id "${id}". Call list_dashboard_features to see valid ids.`,
      };
    }
    return entry;
  },
});

export const featureTools = {
  list_dashboard_features: listDashboardFeaturesTool,
  describe_feature: describeFeatureTool,
};
