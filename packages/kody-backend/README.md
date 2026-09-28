# @kody-ade/backend

Convex backend for Kody — schema, functions, and DB-agnostic import/export
tooling. Convex is live: the dashboard reads and writes it via `CONVEX_URL`.
GitHub remains the engine's execution surface (repos, PRs, issues); this
package replaced GitHub-as-database for Kody's own state.

## Layout

- `convex/schema.ts` — all tables, partitioned by `tenantId` (currently the "owner/name" of the business repo), plus
  `login`/`userKey` for per-user rows. Two global tables (`actionStates`,
  `eventLog`) replace the Kody-Dashboard store repo.
  (intents/agents), `repoStore` (config docs/reports/macros/renderers),
  `users` (user-state/prefs/inbox), `engine` (action state/event log),
  `importExport` (migration surface).
- `convex/_generated/` — placeholder stubs typed from the schema; `npx convex
dev` overwrites them with real codegen.
- `scripts/export-github.ts` — dumps the GitHub backend to plain JSON
  (`dump/<table>.json`), backend-agnostic.
- `scripts/import-convex.ts` — loads a dump into a Convex deployment.
- `src/client.ts` — server-side `ConvexHttpClient` factory (`CONVEX_URL`).
  Injects the `KODY_SERVICE_KEY` service secret into every call.
- `convex/lib/auth.ts` — `serviceQuery`/`serviceMutation` wrappers +
  `requireServiceKey`; the shared-secret auth layer (see below).

## Access control (service key)

Convex functions are exposed to the public internet and Convex has no
built-in API-key auth, so every mutation and every sensitive query is
registered via `serviceQuery`/`serviceMutation` (`convex/lib/auth.ts`).
They require a `serviceKey` arg matching the deployment's
`KODY_SERVICE_KEY` env var (fails closed when unset):

```bash
npx convex env set KODY_SERVICE_KEY "$(openssl rand -hex 32)"   # per deployment (add --prod for prod)
```

## Loop wake scheduling

Convex owns the recurring 5-minute wake check for Kody Loops. Individual Loop
schedules still decide whether work is due. New deployments run in shadow mode
until explicitly enabled:

```bash
npx convex env set KODY_LOOP_WAKE_MODE shadow
npx convex env set KODY_LOOP_DASHBOARD_URL https://<dashboard-host>
npx convex env set KODY_LOOP_WAKE_API_KEY <dedicated-wake-key>
```

Set `KODY_LOOP_WAKE_MODE` to `dispatch` only after shadow receipts match the
current Engine ticks. Store only the purpose-derived pool key in Convex; never
store `KODY_MASTER_KEY` there. GitHub `workflow_dispatch` remains the manual
recovery path.

Server callers never pass the key by hand — `withEscapedKeys`
(`src/client.ts`) injects it from `process.env.KODY_SERVICE_KEY`, so the
same value must be set wherever a server client runs (this package's
`.env.local`, the dashboard's env).

Two queries are **deliberately public** because the browser subscribes to
them via `ConvexProvider` and cannot carry the secret: `chatEvents.since`
and `workflowRuns.list` (see `useConvexLive.ts`). They expose only what
the polled endpoints already served and are rate-bounded with `take`.

Integration tests set the key via `tests/integration/helpers.ts`
(`TEST_SERVICE_KEY`), which auto-injects it into every `t.query`/`t.mutation`.

## First-time setup

```bash
pnpm --filter @kody-ade/backend dev   # logs in, creates the Convex project, live-syncs
```

Production deploys: `pnpm --filter @kody-ade/backend deploy:prod` with
`CONVEX_DEPLOY_KEY` set (CI) — see below.

## Environments

Each Convex project has two deployments; apps pick one via `CONVEX_URL`:

- **dev** — your personal deployment. `pnpm dev` live-syncs functions to it
  and writes its URL to `.env.local` (gitignored). All local work and tests
  target this.
- **prod** — created on first `pnpm deploy:prod`. CLI commands target it with
  `--prod`. To set it up:
  1. `pnpm --filter @kody-ade/backend deploy:prod` (interactive login) — the
     first run creates the prod deployment for the project.
  2. `npx convex env set --prod KODY_SERVICE_KEY <fresh random hex>` — use a
     different key than dev; put the same value in the prod app's env.
  3. For CI: generate a **production deploy key** in the Convex dashboard
     (Project settings → Deploy keys), store it as the `CONVEX_DEPLOY_KEY`
     secret, and run `CONVEX_DEPLOY_KEY=… pnpm deploy:prod` — no login
     needed. We don't have one yet; it must be created from the dashboard.
  4. Point the prod app at the prod URL (`CONVEX_URL` /
     `NEXT_PUBLIC_CONVEX_URL`).

Auth: `npx convex dev` login stores a personal access token in
`~/.convex/config.json`; no other credentials are needed locally.

The live smoke suite is explicit: `pnpm --filter @kody-ade/backend test:smoke`
requires both `CONVEX_URL` and `KODY_SERVICE_KEY`, and verifies the deployed
function registry plus a GuidedFlow write/read/update round trip. CI runs it
when the repository variable `CONVEX_SMOKE_ENABLED` is `true`, using the
`CONVEX_URL` and `KODY_SERVICE_KEY` secrets. This keeps ordinary unit tests
fast while making the deployment boundary an intentional release gate.

## Backups and tenant migration

Convex is the system of record. The Backend admin page (`/backend`) covers
both flows without the CLI:

- **Standing backup:** "Export (backup from database)" reads every registry
  table from Convex (`importExport.exportTable`) into a portable JSON dump.
  Run it routinely; the dump is the rollback artifact.
- **First-time tenant migration:** "Export from GitHub (first migration)"
  maps a legacy GitHub backend to the same dump format; then Import
  (clear first) loads it into Convex.

CLI equivalents remain for scripted use: `pnpm --filter @kody-ade/backend
export:github` and `CONVEX_URL=… pnpm --filter @kody-ade/backend
import:convex --clear-tenantId owner/name`.
