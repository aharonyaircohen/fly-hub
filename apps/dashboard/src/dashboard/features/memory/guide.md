---
id: memory
title: Memory
summary: Store typed personal or repository facts with immutable revision history and controlled recall.
routes:
  - /memory
  - /memory/**
  - /memory-files
  - /memory-files/**
aliases:
  - memory
  - memories
  - remember
  - remembered context
---

# Memory

## What this feature does

Memory stores durable facts that Kody may use across conversations. Entries are typed as `preference`, `fact`, `decision`, or `reference`, scoped either to the signed-in user or the current repository, and rendered in a read-only file workspace grouped by scope and kind. Edits create revisions rather than erasing history.

## When to use it

Use Memory for stable information worth carrying into future turns: preferences, confirmed facts, decisions with reasons, and durable references. Do not use it for temporary task state, secrets, logs, or full documents that already have an authoritative home.

## Available actions and options

- Browse Personal and Repository folders, then browse by memory kind.
- Create an entry with scope, kind, title, summary, details, and an optional reason.
- Edit an entry's kind and content while preserving its scope and revision history.
- Search titles, summaries, details, kind, and scope.
- Read a generated Markdown view containing the current entry and revisions.
- Delete an entry and its revision history after explicit confirmation.
- Agent tools can remember, update, forget, recall by id, search, and list when available.

## Requirements and permissions

- Personal memories require an authenticated user identity.
- Repository memories require an active repository tenant.
- Title is required and limited to 120 characters; summary to 500; details to 20,000; reason to 500.
- Corrections should update the existing memory instead of creating a contradictory duplicate.
- Deletion must be explicit because it removes revision history.

## What will not work

- Memory cannot store secrets, credentials, or access tokens safely.
- Editing cannot change an existing memory from personal to repository scope or the reverse.
- A one-line remembered hook is not the full body; use recall when detail matters.
- Memory is background knowledge, not a permission, policy, runtime state, or proof of current external facts.
- Deleting a memory cannot be undone from its removed revision history.

## Known limitations

- Only relevant memory summaries may be injected into a turn; not every entry appears automatically.
- Very large memory indexes may be truncated and require explicit list/search/recall tools.
- Repository and personal scopes intentionally remain separate.

## Common failures and recovery

- **Duplicate or conflicting entry:** search first, then update the existing memory with correction evidence.
- **Memory not used automatically:** recall it explicitly or make the current question clearly relevant.
- **Wrong scope:** create a new entry in the correct scope and explicitly remove the old one if appropriate.
- **Save rejected:** correct required fields or length limits.

## Related tools and capabilities

Use `remember`, `update_memory`, `forget`, `recall`, `recall_search`, and `list_memories` only when available. Read before update or deletion, and never claim persistence until the tool confirms it.

## Authoritative sources

- `apps/dashboard/src/dashboard/features/memory/components/MemoryFilesPage.tsx`
- `apps/dashboard/src/dashboard/features/memory/components/MemoryFormDialog.tsx`
- `apps/dashboard/src/dashboard/features/memory/components/MemorySearchDialog.tsx`
- `apps/dashboard/src/dashboard/features/memory/lib/memory-files.ts`
- `packages/memory/src`
