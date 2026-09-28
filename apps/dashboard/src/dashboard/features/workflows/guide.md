---
id: workflows
title: Workflows
summary: Build, validate, run, and monitor an Agent-owned graph of Capability calls.
routes:
  - /workflows
  - /workflows/**
aliases:
  - workflow
  - workflows
---

# Workflows

## What this feature does

Workflows connect Capability calls into one graph run by one selected Agent. A Workflow owns step order, input mappings, conditional branches, default branches, bounded cycles, approval behavior, and its saved definition.

Local Workflows are stored in Convex. Store Workflows are read-only assets activated for the repository. Runs execute through the installed Kody Engine and report their state back to the Dashboard.

## When to use it

Use a Workflow when an outcome needs more than one Capability call, explicit ordering, branching, conditions, retries through a bounded cycle, or a human approval boundary. Use a Capability directly when the outcome is one independent action. Use a Loop when the Workflow needs a repeated trigger or schedule.

## Available actions and options

- List, search, refresh, select, and inspect Workflows.
- Create a local Workflow with a name, one Agent, and at least one Capability step.
- Add or remove steps, choose the starting step, connect steps, and create decision branches.
- Map input and prior step results into later steps.
- Add conditions, one default branch, and bounded backward edges with `maxIterations`.
- Edit or delete local Workflows.
- Remove a Store Workflow from the repository without deleting the Store asset.
- Choose a trust level. Approval-required runs need explicit approval; trusted runs may start directly when policy allows.
- Run with schema-driven form fields or raw JSON when the input schema cannot be rendered as a simple form.
- Inspect active triggers, current run state, outputs, failures, and GitHub execution evidence.
- Resume a paused or failed run, or retry it with new input.

## Requirements and permissions

- A connected repository and authenticated Dashboard operator are required.
- Creation requires at least one available Capability and a selected Agent.
- Every step must reference a declared Capability, and `startAt` must reference an existing step.
- Every saved step must be reachable, and at least one terminal step must be reachable.
- Conditional branches require one unambiguous default path.
- Backward edges require a finite positive `maxIterations`.
- Run input must satisfy the Workflow input schema.
- Execution requires a compatible installed Kody Engine, its GitHub workflow, credentials, and any Capability-specific secrets.

## What will not work

- A Workflow cannot provide a schedule or recurring trigger; use a Loop or event trigger.
- A Workflow cannot replace Capability instructions, tools, skills, permissions, or implementation settings.
- A Workflow cannot contain an undeclared or unavailable Capability.
- A cycle without `maxIterations` will not validate.
- A graph with missing targets, unreachable steps, ambiguous branches, no default branch, or no terminal path will not save.
- Store Workflows cannot be edited or deleted from the shared Store through this page; they can only be removed from the current repository.
- The Dashboard cannot prove a run succeeded merely because dispatch was accepted; final Engine state and evidence are required.
- A guide does not make a run tool available. The Agent must use only tools present in the current tool index.

## Known limitations

- Runtime behavior depends on the installed Engine version; a similarly named Workflow contract in another package must not be substituted.
- Complex input schemas fall back to raw JSON instead of generated fields.
- Store Workflows are intentionally read-only in the Dashboard.
- Approval and trust settings do not bypass hard permissions, missing secrets, Engine availability, or Capability restrictions.

## Common failures and recovery

- **No Capabilities available:** activate or create the required Capabilities, then reopen the editor.
- **Workflow needs attention:** correct every graph validation message before saving.
- **Approval required:** approve the exact pending run, then start it with the returned approval id.
- **Run unavailable:** verify the Workflow is runnable, the Engine is installed, and required configuration and secrets exist.
- **Run failed or paused:** inspect its step output and evidence, then resume when state is recoverable or retry with corrected input.
- **Store Workflow cannot be edited:** create a local Workflow if repository-specific changes are required.

## Related tools and capabilities

Agents may use `list_workflows`, `read_workflow`, and `run_workflow` only when those tools appear in the current tool index. Capability tools manage the executable steps; Loop and trigger tools manage repeated or event-driven activation. Tool results and runtime validation override this guide.

## Authoritative sources

- `apps/dashboard/docs/workflows.md`
- `apps/dashboard/docs/concepts/models/workflow.md`
- `apps/dashboard/docs/concepts/models/workflow-implementation.md`
- `apps/dashboard/src/dashboard/features/workflows/components/WorkflowsManager.tsx`
- `apps/dashboard/src/dashboard/features/workflows/components/WorkflowEditorDialog.tsx`
- `apps/dashboard/src/dashboard/features/workflows/components/WorkflowRunDialog.tsx`
- `packages/kody-chat-dashboard/src/dashboard/lib/workflow-definitions.ts`
