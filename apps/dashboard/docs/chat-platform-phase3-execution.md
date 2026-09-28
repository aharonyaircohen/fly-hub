# Phase 3 execution plan — steps 1–5 (the high-ROI arc)

Scopes [chat-platform-phase3.md](chat-platform-phase3.md) down to the parts
worth doing now; steps 6–7 (surface scoping activation, brand admin UI)
deferred until an external client is on the horizon. Method unchanged:
`pnpm test:gate` green per commit, one concern per commit, worktree,
pixel-invisible to the user throughout.

## Step 1 — Visual parity for the flip (~1 commit)

Target: toggle ON renders pixel-identically to toggle OFF.

- [ChatRailShell.tsx](../src/dashboard/lib/components/ChatRailShell.tsx) —
  rework the `flipActive` branches:
  - Chat column: drop the `flex-1` main-column treatment; keep the classic
    fixed `railWidth` (localStorage `kody:rail-width`, default 440) and
    re-enable the drag handle (today disabled when `flipActive`).
  - Page column: drop `md:w-[560px] md:max-w-[50vw]`; back to `flex-1`.
  - Keep (invisible): panel host wiring, tracing events, deep links.
  - Decide: the collapse/expand strip (`PanelRightClose`) is a visible
    addition — remove it or keep it as the one deliberate improvement.
    Default: remove; parity means parity.
- Gate: a vitest DOM assertion that both toggle states produce the same
  layout classes/widths on a representative route; existing
  `chat-first-panel` testid assertions updated.

## Step 2 — Default ON (~1 commit)

- [use-chat-first-layout.ts](../src/dashboard/lib/hooks/use-chat-first-layout.ts)
  — flip the prepared constant `CHAT_FIRST_DEFAULT` to `true` (an explicit
  stored `"0"` still wins). Keep the Settings toggle one release as the
  escape hatch.
- Watch client traces (`panel:*`) for a few days before step 4.

## Step 3 — Migrate the last 10 pages (~10 small commits)

`cms`, `cms-config`, `content`, `content-model`, `fly`, `org`, `runner`,
`scenario`, `trust`, `views` → one page-plugin each under
[src/dashboard/lib/chat/plugins/](../src/dashboard/lib/chat/plugins/),
same recipe as phase 2.4 (route keeps working, renders the panel view),
same lazy-panel bundle discipline as 2.5 (`plugin-dirs.mjs` check).
Note: `fly`/`runner` files are being moved by the in-flight
`infrastructure/plugins/fly` refactor sitting uncommitted in the tree —
land or drop that refactor **before** migrating these two, don't race it.

## Step 4 — Retire the legacy shell path (~2 commits)

Only after steps 1–3 are live and traces are quiet:

- Delete the non-flip branches in `ChatRailShell` (classic rail layout,
  `flipActive` conditionals collapse to unconditional).
- Delete `use-chat-first-layout.ts` + the Settings card toggle.
- Re-verify per-surface bundle sizes (2.5 discipline) and the public
  `/client` surface, which must stay outside the flip (`publicRoute` guard
  today).

## Step 5 — Auto-wire engine plugin tools (~2 commits)

Close the phase-1 honest limit: default `kody-live` chat gets plugin tools
without the manual Capabilities step.

- Today: [trigger/route.ts](../app/api/kody/chat/trigger/route.ts) already
  appends the `pluginTools` bearer (fail-open);
  [plugin-tools-config.ts](../src/dashboard/lib/chat/platform/plugin-tools-config.ts)
  builds the `claudeCode.mcpServers` entry — but someone must paste it
  into a profile by hand.
- Change: when ≥1 plugin registers server tools, the dispatch path
  injects the `mcpServers` entry (and the derived
  `mcp__kody-plugin-tools` allowlist token) into the effective profile
  automatically. Zero registered plugins → dispatch stays byte-identical
  (existing guarantee, keep the test).
- Constraint: dashboard-side only — no engine code, no workflow YAML
  (thin-YAML rule). If the engine can't take the entry via existing
  config channels, stop and surface the conflict instead of bending scope.
- Gate: int test asserting the dispatched profile contains the entry when
  a fixture plugin registers a server tool, and doesn't when none do.

## Order and effort

1 → 2 → (3 ∥ 5) → 4. Rough sizing: step 1 a day, step 2 minutes,
step 3 ~half a day per page, step 4 a day, step 5 one to two days.
Step 4 is the only irreversible one — everything before it can ship and
sit safely.
