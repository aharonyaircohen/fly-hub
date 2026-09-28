---
id: agency
title: AI Agency
summary: Manage intents, loops, run history, and portable Agency bundles.
routes:
  - /agency
  - /agency/**
  - /agency-runs
  - /agent-loops
  - /agent-loops/**
  - /company
aliases:
  - ai agency
  - agency runs
  - intent
  - intents
  - agent loop
  - agent loops
  - import agency
  - export agency
---

# AI Agency

## What this feature does

AI Agency groups the operator-facing definitions and history used to direct work. Intents describe desired outcomes and controls. Loops decide when to start a Workflow or Capability. Runs show immutable execution history. Import/Export moves the portable parts of an Agency between repositories.

## When to use it

Use Intents to record durable operating goals and policies, Loops for scheduled or event-driven activation, Runs to inspect what actually happened, and Import/Export to copy an approved Agency setup to another repository.

## Available actions and options

- Browse, create, edit, rename, move, and delete plain-text Intent files through the shared file workspace.
- Assign Intent guidance to one or more Agents where the guidance contract supports an Agent audience.
- List, search, create, edit, enable, disable, run now, and delete Loops.
- Configure a Loop trigger as a schedule or supported event/webhook, then target one concrete Workflow or Capability.
- Inspect Agency Runs by status, target, Agent, timing, outputs, evidence, and failure details. Runs are read-only.
- Export Agents, complete Capability folders, Context entries and audiences, commands, Instructions, and portable Engine configuration as one JSON bundle.
- Import the bundle with `skip` or `overwrite` collision handling. Items are applied independently and configuration is applied last.

## Requirements and permissions

- Repository-scoped features require an authenticated connected repository.
- A Loop target must already exist and must be exactly one Workflow or Capability.
- Scheduled and event triggers must satisfy the current Loop contract and Engine support.
- Import writes repository-owned definitions and therefore needs write access.
- Run inspection depends on recorded Run state and evidence; UI projections are not the source of truth.

## What will not work

- An Intent cannot execute work, schedule itself, or own runtime state.
- A Loop cannot own Workflow steps or Capability instructions.
- Import/Export is not a complete runtime backup. It excludes Intent, Todo, Loop, Workflow, Run, Memory, secrets, variables, inbox, notifications, default branch, runtime state, and history.
- Import success does not prove an imported Agent or Capability can run.
- Runs cannot be edited to make an execution appear successful.
- Disabling a Loop prevents new activations but does not rewrite past Runs.

## Known limitations

- Portable bundles intentionally cover reusable operating definitions, not all Dashboard data.
- Event and schedule execution depend on the installed Engine version and configured credentials.
- Partial import can contain both successes and failures; inspect each item result.

## Common failures and recovery

- **Target unavailable:** activate or create the required Workflow or Capability, then update the Loop.
- **Loop does not fire:** verify it is enabled, its trigger is valid, and Engine/event delivery is healthy.
- **Import collision:** choose `skip` to preserve the destination or `overwrite` to replace the matching portable item.
- **Run appears stuck or failed:** inspect recorded step state and evidence; do not infer success from dispatch alone.

## Related tools and capabilities

Use Intent, Loop, Workflow, Capability, and Run tools only when present in the current tool index. A guide explains ownership but does not authorize writes or execution.

## Authoritative sources

- `apps/dashboard/docs/company.md`
- `apps/dashboard/docs/concepts/models/agent.md`
- `apps/dashboard/docs/concepts/models/agent-implementation.md`
- `apps/dashboard/docs/concepts/models/intent.md`
- `apps/dashboard/docs/concepts/models/loop.md`
- `apps/dashboard/docs/concepts/models/run.md`
- `apps/dashboard/src/dashboard/features/agency/components/IntentFilesView.tsx`
- `apps/dashboard/src/dashboard/features/agency/components/LoopsPage.tsx`
- `apps/dashboard/src/dashboard/features/agency/components/AgencyRunsPage.tsx`
- `apps/dashboard/src/dashboard/features/agency/components/AgencyArchitect.tsx`
