# Phase 2 — Dashboard becomes chat; pages become plugins

Continues [chat-platform-phase1.md](chat-platform-phase1.md). Same method:
mocked gate (`pnpm test:gate`) green per commit, standards + layer zones
enforced, honest boundaries. Work happens in a clean worktree; each step
merges to main when green.

## Steps

**Step 1 — Engine tool bridge (fail-open).**
Plugin server tools today reach only the in-process `kody` backend. Bridge
them to the default `kody-live` backend the way the engine already consumes
external tools: **MCP config, not engine code** (see memory/engine docs —
`claudeCode.mcpServers` in the consumer repo's profile). Dashboard side:
(a) an MCP-over-HTTP endpoint exposing the server tool registry, auth via a
purpose-prefixed HMAC of KODY_MASTER_KEY (chat-token pattern); (b) a config
helper the Tools/company flow uses to write the mcpServers entry. Fail-open:
missing config → chat works exactly as today, no plugin tools.

**Step 2 — Shell flip behind a toggle.**
Chat becomes the main column; a **side-panel API** (platform slot) renders
plugin views beside it. Panel views get real URLs (deep links + back
button). Unified client tracing for mode/backend/plugin events ships here.
The current shell remains the default until parity; the flip is a setting.

**Step 3 — Pilot page-plugin: tasks.**
The tasks page migrates into a plugin: tools (server half), panel views,
its settings. Old route keeps working (renders the panel view).

**Step 4 — Migrate remaining pages one by one.**
Previews, secrets, inbox, activity, … — one plugin per page, one
commit each, each keeping its settings surface.

**Step 5 — Retire the old shell/nav.**
Only after every page has parity. Per-surface bundles verified.

**Step 6 — Server-side surface scoping.**
HMAC-scoped surface tokens (chat-token/preview-ticket pattern) so /client
brand surfaces can face real external users. Closes the M6 caveat.

## Parallel track (not phase 2)

Brand registry + operator admin UI (create/edit brands feeding the branding
plugin) — independent of the shell work.
