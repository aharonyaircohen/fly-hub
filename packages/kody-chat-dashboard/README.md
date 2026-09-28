# Kody Chat Dashboard integration

Private Kody-specific chat integration consumed by the Dashboard host. This is
a source package, not a second deployable Next.js application.

The public, host-neutral package is `@kody-ade/kody-chat`. This private package
owns Kody-specific client surfaces, chat backends, plugins, and route handlers.
The Dashboard owns route mounting and deployment.

## What's inside

- **Client brand surfaces** — `/client/<slug>` full-page branded chat.
  One deployment serves every brand; brands resolve by slug (repo
  `brands/<slug>.json` with built-in fallbacks). Unknown slugs 404.

## Project docs

- [Request Blueprints](../../docs/request-blueprints.md) — semantic request
  definitions that generate user and model guidance, with ownership, handoff,
  versioning, and verification boundaries.
- [Creating proper GuidedFlows](../../docs/guided-flows.md) — design,
  ownership, persistence, versioning, and verification.
- [Project behavior](../../docs/project-behavior.md) — route ownership,
  repository context, and user-facing verification rules.
- **Chat backends** — `/api/kody/chat/*` (in-process model, Brain proxy,
  GitHub Actions engine trigger) and `/api/kody/events/*` (ingest + stream).
- **Chat platform** — `src/dashboard/lib/chat/{core,platform,plugins,surface}`.
  Layering (`core ← platform ← plugins/surface`) is lint-enforced as errors.
  The side-panel mechanism lives in the platform layer; panel *content* is
  plugin-supplied, so hosts (or future client features) ship panels as plugins.

## Library exports

Consumers (the dashboard, future hosts) import via package exports:

```ts
import { ... } from "@kody-ade/kody-chat-dashboard/platform";
import KodyChat from "@kody-ade/kody-chat-dashboard/components/KodyChat";
import { resolveClientBrand } from "@kody-ade/kody-chat-dashboard/client-brand";
```

Source-level TS exports — Next.js consumers add
`transpilePackages: ["@kody-ade/kody-chat-dashboard"]`.

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
```

### Environment

Same contract as the dashboard — one secret, everything else optional:

| Variable                  | Required | Purpose                                              |
| ------------------------- | -------- | ---------------------------------------------------- |
| `KODY_MASTER_KEY`         | Yes      | Vault crypto + chat-ingest HMAC (`pnpm vault:init`)  |
| `GITHUB_TOKEN`            | Yes      | Server-side GitHub reads (brand/credential bootstrap) |
| `KODY_CLIENT_BRAND_REPO`  | No       | `owner/repo` whose brand registry serves public brands |
| `KODY_CHAT_WORKFLOW_REPO` | No       | Engine repo for chat (default: connected repo)       |
| `KODY_CHAT_WORKFLOW_ID`   | No       | Chat workflow file (default `kody.yml`)              |

## Testing

| Layer | Command          | What it proves                                                        |
| ----- | ---------------- | --------------------------------------------------------------------- |
| Unit  | `pnpm test:unit` | Pure logic: reducers, parsers, stores, token/vault crypto (vitest, node env, no DOM) |
| Int   | `pnpm test:int`  | API route handlers against mocked GitHub (vitest + nock)              |
The canonical browser and live integration journeys run through
`apps/dashboard` on port 3333. Package tests cover private integration logic;
the public package also has a clean external-consumer browser test.
