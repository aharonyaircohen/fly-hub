# fly-hub

This repository starts with the Fly runtime and Fly dashboard source copied unchanged from `aharonyaircohen/kody-chat` commit `01696f42b05e15f85eeb6a55432baeba581878a6`.

The copied source includes `packages/fly`, the original `/fly/*` pages, their Fly and preview API routes, and their dashboard components. The original dashboard and shared package dependencies are also present so the Fly pages keep their existing authentication, vault, UI shell, and backend behavior. This is a faithful working copy of the Kody dashboard's Fly experience; the shared code has not yet been reduced to a Fly-only dependency set.

Extraction rule: preserve the original Fly pages and behavior. If a required dependency cannot be carried across without changing that behavior, stop and clarify the intended change before implementing a substitute.

## Local dashboard

Install with `pnpm install --frozen-lockfile`, configure `apps/dashboard/.env.local` from the original dashboard environment, and run `pnpm --filter kody-dashboard dev`. Open `http://localhost:3333/fly/machines` and sign in with the existing Kody account. The copied Fly pages retain their original routes, components, and actions. No replacement Fly dashboard has been created here.
