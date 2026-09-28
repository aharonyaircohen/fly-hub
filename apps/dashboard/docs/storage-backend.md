# Storage backend: Convex replaces GitHub-as-database

**Decision (Jul 2026):** Kody's own state moves from the GitHub backend to
Convex. GitHub remains the engine's execution surface — repos, branches, PRs,
issues, CI — but stops being a database.

## Why

- The backend forced every read/write through the GitHub contents API:
  rate limits, CAS retries, polling for freshness.
- Convex gives real queries, transactions, and live subscriptions (UI updates
  push instantly instead of re-fetching).
- One Convex deployment is multi-tenant: every table is keyed by `tenantId`,
  so all businesses share it. A business no longer needs a backend — a repo
  is only required where the engine does code work.

## What lives where

| GitHub (engine workspace)          | Convex (system of record)                |
| ---------------------------------- | ---------------------------------------- |
| Repos, branches, code              | Workflow definitions and runs            |
| PRs and issues the engine works on | Chat sessions, turns, events             |
| Commits, reviews, CI runs          | Intents, agents, reports                 |
|                                    | Config docs, macros, view renderers      |
|                                    | User state, notification prefs, inbox    |
|                                    | Engine action state + event log (global) |

GitHub artifacts are referenced by ID (repo, PR/issue number), not stored in.

## Where the code is

`packages/kody-backend` — schema, functions, four-layer test suite (unit /
integration / smoke / e2e), and migration tooling:

- `scripts/export-github.ts` — dumps the backend to plain JSON (portable,
  backend-agnostic).
- `scripts/import-convex.ts` — loads a dump into a deployment.

See the package [README](../../../packages/kody-backend/README.md) for setup,
environments, and migration steps.

## Migration status

Convex is live: the dashboard's state layer reads and writes it via
`CONVEX_URL`. The Backend admin page (`/backend`) is the operator surface:

- **Export (backup from database)** — the standing backup tool. Reads every
  registry table from Convex (`importExport.exportTable`) and downloads a
  portable JSON dump. Run it routinely; the dump is the rollback artifact.
- **Export from GitHub (first migration)** — one-time path for a tenant still
  on a GitHub backend: downloads the backend as a tarball, maps files
  to backend tables, and produces the same dump format.
- **Import** — loads a dump into Convex (`importExport.importChunk`),
  optionally clearing the tenant first.

First-time tenant migration: Export from GitHub → Import (clear first).
Ongoing operations: Export (database) is the backup; GitHub is only the
engine's execution surface.

Follow-ups: paginate unbounded `.collect()` queries and batch `clearRepo`
for large tenants.

## Engine (kody2) chat transcript reads

The engine's chat runner (kody2 `src/chat/session-store.ts`) reads and writes
the same typed Convex conversation timeline as Direct, Brain, and Live
(`conversations.get` + `conversations.appendEntry`). It fails closed when
canonical storage is unavailable; there is no JSONL transcript fallback or
dual write.

The repo running `kody.yml` does not receive `CONVEX_URL`,
`KODY_SERVICE_KEY`, or user vault secrets. GitHub OIDC identifies the workflow
to Dashboard, and Dashboard performs the repository-scoped backend and secret
operations server-side.

The tenant scope is derived from `GITHUB_REPOSITORY` (`owner/repo`), which
matches the dashboard's `tenantIdFor(owner, repo)`.

The workflow dispatch carries only the conversation id and current request;
the engine retrieves the active agent epoch from Convex.
