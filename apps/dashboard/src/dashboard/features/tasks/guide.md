---
id: tasks
title: Tasks and Todos
summary: Create and manage GitHub Issue-backed work, inspect Engine progress, and operate regular or Loop-owned todo lists.
routes:
  - /tasks
  - /tasks/**
  - /todos
  - /todos/**
  - /[issueNumber]
aliases:
  - task
  - tasks
  - todo
  - todos
  - task board
  - issue task
---

# Tasks and Todos

## What this feature does

A Task is a GitHub Issue projected into Dashboard work lanes using the Engine's canonical `kodyState`. Tasks combine structured issue creation, editing, comments, assignees, labels, priority, attachments, pipeline actions, Run history, sessions, Pull Request state, and previews. Todos are visible worklists for regular tasks or Loop-owned work.

## When to use it

Use Tasks for repository work that needs a durable Issue and optional Kody execution. Use Todos to organize actionable items inside a normal list or a Loop's repeated worklist.

## Available actions and options

- List, search, filter, select, refresh, create, duplicate, edit, and close Tasks according to available actions.
- Create categories `feature`, `enhancement`, `refactor`, `docs`, or `chore` with scope `frontend`, `backend`, `fullstack`, `infra`, or `ci-cd`.
- Set priority, execution mode, structured summary/requirements, affected area, acceptance criteria, context, labels, assignees, and attachments.
- Read Description, Comments, and Runs; post comments and inspect session history and step evidence.
- Start, resume, rerun, cancel, approve, request fixes, or retry with context when the Task's current state exposes those actions.
- Retry with empty context to resume the last step, or with new context to restart the flow from the beginning after confirmation.
- Manage Todo lists and items, including regular and Loop-owned lists, through their current controls.

## Requirements and permissions

- Tasks require an authenticated repository with Issue access; mutations need write permission.
- Task creation requires a title. Structured fields are written into the Issue body and labels.
- Creation does not automatically start Kody; the user runs the Task when ready.
- Lane placement comes from canonical `kodyState` when present, not visible `kody:*` labels.
- Engine actions require a ready Engine, current state eligibility, credentials, and any approval required by the action.

## What will not work

- Manually changing `kody:*` labels will not move a Task while canonical `kodyState` exists.
- Creating or editing an Issue does not prove execution started.
- Retry with context is not a resume; it restarts the flow from the beginning.
- A dispatch response does not prove the Run or Pull Request succeeded.
- Todo state cannot replace Task, Loop, Workflow, or Run ownership.
- Actions hidden by the current Task state should not be simulated through chat.

## Known limitations

- GitHub and Engine projections can briefly lag canonical state.
- Attachments, labels, collaborators, comments, and Pull Request details depend on GitHub APIs and permissions.
- Stale Engine state can pin a Task in the wrong lane until the source state is corrected.

## Common failures and recovery

- **Task in wrong lane:** inspect and repair canonical `kodyState`; do not relabel as a workaround.
- **Run action unavailable:** verify Task state, Engine readiness, approvals, and repository permission.
- **Execution appears stuck:** inspect Run history, sessions, logs, and the latest state comment.
- **Retry did the wrong thing:** clear context to resume or provide context and confirm a full restart intentionally.
- **New Task not running:** use the explicit Run action; auto-trigger is disabled on creation.

## Related tools and capabilities

Task and Todo tools must read current state before mutation. Execution tools hand work to the Engine; their accepted response is not final evidence.

## Authoritative sources

- `apps/dashboard/docs/tasks.md`
- `apps/dashboard/src/dashboard/features/tasks/components/CreateTaskDialog.tsx`
- `apps/dashboard/src/dashboard/features/tasks/components/EditTaskDialog.tsx`
- `apps/dashboard/src/dashboard/features/tasks/components/TaskDetail.tsx`
- `apps/dashboard/src/dashboard/features/tasks/components/TaskRunsList.tsx`
- `apps/dashboard/src/dashboard/features/tasks/components/TodoControl.tsx`
- `apps/dashboard/src/dashboard/lib/tasks/derive-column.ts`
