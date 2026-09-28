---
id: inbox
title: Inbox
summary: Review repository mentions and legacy notification requests, with Reports as the preferred structured review surface.
routes:
  - /inbox
aliases:
  - inbox
  - mentions inbox
  - approval inbox
---

# Inbox

## What this feature does

Inbox displays per-user, per-repository notification entries created from GitHub-backed mentions and older Agent request flows. Entries are grouped as unread and read, link to their source, and can render supported Issue or Pull Request threads inside the Dashboard.

Reports is the preferred surface for new structured findings and suggested actions. Inbox remains useful for mentions and backward-compatible notification delivery.

## When to use it

Use Inbox to notice and follow repository mentions or inspect older request entries. Use Reports when a Capability publishes reviewable output or proposed actions.

## Available actions and options

- View unread and read entries, refresh, open an entry, and mark it read.
- Mark all entries read.
- Read Issue or Pull Request bodies and comments in an inline dialog, or open the source on GitHub.
- Follow unsupported thread types directly to GitHub.
- For legacy request entries, use the displayed approve, reject, or dismiss action only when that request contract is still active.
- Fix a missing token scope through the linked settings path.

## Requirements and permissions

- Entries are scoped to the signed-in user and connected repository.
- GitHub source threads require repository access.
- Per-user read state requires the configured user-state storage and any required token scope.
- Mention delivery requires webhook handling and a resolvable recipient.

## What will not work

- Inbox should not be used as the approval model for new Capability designs.
- Marking an entry read does not resolve, merge, approve, or dismiss the underlying GitHub work.
- Only Issue and Pull Request threads render inline; other sources open externally.
- An empty operator list means recommendation mentions may reach nobody.
- Inbox cannot replace Reports for structured findings and suggested actions.

## Known limitations

- Some entries are legacy and may expose actions that newer flows no longer use.
- Notification delivery is separate from execution truth; an entry is not proof that work ran successfully.
- External source availability and permissions control what the inline thread can show.

## Common failures and recovery

- **Missing token scope:** use the settings link, update authentication, and refresh.
- **Empty inbox despite recommendations:** configure repository operators and verify webhook delivery.
- **Thread cannot render:** open the source on GitHub.
- **Action unavailable or stale:** inspect the current Report, Run, Issue, or Pull Request rather than retrying a legacy action blindly.

## Related tools and capabilities

Inbox read and action tools must be present in the current tool index. Agents should prefer Report actions for new structured review flows and never infer that marking a notification changed its source.

## Authoritative sources

- `apps/dashboard/docs/inbox.md`
- `apps/dashboard/docs/reports.md`
- `apps/dashboard/src/dashboard/features/inbox/components/InboxList.tsx`
- `apps/dashboard/src/dashboard/features/inbox/components/InboxCard.tsx`
- `apps/dashboard/src/dashboard/features/inbox/components/InboxThreadDialog.tsx`
