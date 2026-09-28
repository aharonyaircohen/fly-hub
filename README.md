# fly-hub

This repository starts with the Fly runtime and Fly dashboard source copied unchanged from `aharonyaircohen/kody-chat` commit `01696f42b05e15f85eeb6a55432baeba581878a6`.

The copied source includes `packages/fly`, the original `/fly/*` pages, their Fly and preview API routes, and their dashboard components. The app opens directly on Fly Config, with Fly navigation and the original repository switcher. The Kody Chat shell and unrelated page routes have been removed. Shared authentication, vault, backend, and component code remains where the Fly pages use it; that dependency set has not yet been reduced to Fly-only packages.

Extraction rule: preserve the original Fly pages and behavior. If a required dependency cannot be carried across without changing that behavior, stop and clarify the intended change before implementing a substitute.

## Local dashboard

Install with `pnpm install --frozen-lockfile`, configure `apps/dashboard/.env.local` from the original dashboard environment, and run `pnpm --filter kody-dashboard dev`. Open `http://localhost:3333/` and sign in with the existing account. Connect or choose a repository to use its Fly configuration. The copied Fly pages retain their original routes, components, and actions. No replacement Fly resource pages have been created here.
