---
id: vibe
title: Vibe
summary: Keep Chat, a selected Issue, live preview, and explicit execution handoff in one focused workspace.
routes:
  - /vibe
aliases:
  - vibe
  - vibe coding
  - vibe preview
  - run kody from vibe
---

# Vibe

## What this feature does

Vibe combines the persistent Chat rail, a compact Issue list, task details, and the shared Preview browser. Selecting an Issue scopes both Chat and preview to that Task. The selected Issue and optional detail overlay are URL-backed so refresh and shared links restore the workspace.

## When to use it

Use Vibe to discuss a visual change, create or select its Issue, inspect the current preview, refine the plan, and explicitly hand a ready open Issue to Kody execution.

## Available actions and options

- Select an open Issue and keep it in the URL with `?issue=<number>`.
- Open task detail in an overlay while preserving the underlying Chat and preview.
- Use saved URL or Fly branch preview environments, paths, device sizes, refresh, inspection, uploads, and macros from the shared Preview feature.
- Feed selected preview evidence and the selected Task into Chat.
- Create an Issue from Chat and optimistically keep it selected while GitHub list data catches up.
- Run Kody on the selected open Issue through the explicit Vibe action.
- Review CI, Pull Request, preview, approve/fix/cancel, and merge-related state through the reused Task and Preview controls.

## Requirements and permissions

- A connected repository and authenticated GitHub identity are required.
- Execution requires a selected open Issue, a ready Engine/Fly path, repository permission, model credentials, and required secrets.
- The Issue body must contain the plan the Engine should execute.
- Preview inspection needs a reachable and embeddable environment.

## What will not work

- Vibe cannot run without a selected Issue.
- The Run action hides after work has started so the same Issue is not dispatched twice from that control.
- Chat planning or Issue creation alone does not start execution.
- A blank or blocked iframe cannot be fixed by prompt instructions.
- Selecting an Issue does not guarantee a preview exists.
- Dispatch success does not prove implementation, commit, Pull Request, CI, or merge success.

## Known limitations

- GitHub list propagation can lag immediately after Issue creation; optimistic selection is temporary.
- Preview behavior inherits iframe, cross-origin, authentication, and inspector limitations.
- Runtime choice and availability depend on current Engine and Fly configuration.

## Common failures and recovery

- **New Issue loses selection:** wait for GitHub propagation and reselect if the optimistic pin expires.
- **Run action missing:** confirm the Issue is selected and still in the open column.
- **Dispatch fails:** inspect Engine/Fly configuration, credentials, and returned error.
- **Preview unavailable:** choose or configure a valid environment and verify embedding.
- **Work started but no Pull Request:** inspect the real Run and Engine logs; do not dispatch the same Issue blindly.

## Related tools and capabilities

Vibe uses Task, Issue, Preview, and execution tools only when present. The selected Task and preview are context, not extra permissions.

## Authoritative sources

- `apps/dashboard/docs/vibe-and-voice.md`
- `apps/dashboard/src/dashboard/features/vibe/components/VibePage.tsx`
- `apps/dashboard/src/dashboard/features/vibe/components/VibeIssueList.tsx`
- `apps/dashboard/src/dashboard/features/vibe/components/VibeRunButton.tsx`
- `apps/dashboard/src/dashboard/features/previews/components/PreviewBrowser.tsx`
- `apps/dashboard/src/dashboard/features/tasks/components/TaskDetail.tsx`
