---
id: engine-setup
title: Engine Setup
summary: Detect whether the connected repository can run Kody and guide initialization when it cannot.
routes:
aliases:
  - engine setup
  - initialize engine
  - install engine
  - kody engine setup
---

# Engine Setup

## What this feature does

Engine Setup checks the active repository and shows a warning when Kody Engine is not ready. Its action starts the built-in `initialize-kody-engine` Guided Flow in Chat, where the user reviews and performs the required setup.

## When to use it

Use it when workflow, capability, task, or live Agent execution is unavailable because the repository lacks a valid Engine installation or configuration.

## Available actions and options

- Check setup status for the active repository.
- Refresh status when the repository changes or the cached check is stale.
- Start the guided Engine initialization flow from the warning.
- Review the setup before applying it through the existing Guided Flow and Engine install paths.

## Requirements and permissions

- A repository must be connected.
- Installation needs repository write permission and the credentials required by the Engine install route.
- The repository must support GitHub Actions for the base runtime.
- Runtime model, secrets, operators, and optional Fly configuration remain separate setup concerns.

## What will not work

- The warning cannot install Engine by itself; it only starts the guided flow.
- Hiding or dismissing UI does not make the repository runnable.
- Installing files does not prove a live run succeeds.
- Fly is not required for the base GitHub Actions runtime and should not be treated as the default Engine requirement.

## Known limitations

- Status is cached for five minutes but refreshes on mount.
- Setup status can verify installation shape, not every external credential or future Capability requirement.
- A complete proof still needs a real Engine run and returned evidence.

## Common failures and recovery

- **No connected repository:** connect one before initializing Engine.
- **Install action denied:** verify repository write access and authentication.
- **Still not ready after install:** refresh status, inspect the Engine files and configuration, then run the guided flow again.
- **Dispatch fails after setup:** inspect GitHub Actions, model configuration, secrets, and Engine logs separately.

## Related tools and capabilities

The `initialize-kody-engine` Guided Flow explains and performs setup through existing Engine APIs. Feature guides do not expose repository writes on their own.

## Authoritative sources

- `apps/dashboard/docs/engine-install.md`
- `apps/dashboard/docs/dashboard-setup.md`
- `apps/dashboard/src/dashboard/features/engine-setup/hooks/useEngineSetupOpeningAction.ts`
- `apps/dashboard/src/dashboard/features/engine-setup/hooks/useEngineSetupStatus.ts`
- `packages/kody-chat-dashboard/src/dashboard/lib/guided-flows/builtins/initialize-kody-engine.ts`
