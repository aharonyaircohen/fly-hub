---
id: messages
title: Messages
summary: Provide GitHub Discussions-backed team channels, comments, mentions, and per-user unread state.
routes:
  - /messages
  - /messages/**
aliases:
  - messages
  - team messages
  - message channel
  - discussion channel
---

# Messages

## What this feature does

Messages is a team-chat surface backed by GitHub Discussions. A `#`-titled Discussion is a channel and each message is a Discussion comment. Human mentions notify GitHub users; known Agent mentions dispatch a one-shot Agent request whose response returns to the thread.

## When to use it

Use Messages for repository-scoped team conversation that should remain visible in GitHub and participate in the existing mention, push, Slack, and Inbox delivery paths.

## Available actions and options

- List channels, select one, read its comment feed, and create a channel in the configured Discussion category.
- Write Markdown messages with mention autocomplete.
- Mention a human `@login` or a known Agent `@slug`.
- Delete a channel and its messages with the required confirmation and permission.
- See per-channel unread indicators and mark a channel seen by opening it.
- Use a full GitHub username even when it is not suggested by autocomplete.

## Requirements and permissions

- GitHub Discussions must be enabled and a usable Discussion category must exist.
- Reading and posting require repository Discussion access; channel deletion needs sufficient permission.
- Per-user unread state requires authenticated user storage and the required token scope.
- Agent mentions only dispatch when the slug resolves to an active repository Agent and webhook delivery is working.

## What will not work

- Messages cannot operate as a separate private chat database; content is stored in GitHub Discussions.
- Turning Discussions off disables the feature rather than creating local fallback channels.
- Autocomplete is not an authorization list and does not guarantee a typed login exists.
- Mentioning `@kody` command handles does not notify them as human recipients.
- Deleting a channel deletes the underlying Discussion and its messages; it is not a local hide action.

## Known limitations

- Channel and message availability follows GitHub API, category, permission, and webhook limits.
- Unread state is per user and repository, not shared team state.
- Agent replies are asynchronous and depend on Engine execution.

## Common failures and recovery

- **Messages disabled:** enable GitHub Discussions and configure a category.
- **Unread state fails:** update the required token scope and reopen the channel.
- **Mention produces no notification:** verify the login, webhook registration, notification preferences, and author/action filters.
- **Agent does not reply:** verify the Agent slug is active and inspect its dispatched Run.

## Related tools and capabilities

Message tools may list channels, read comments, post, or delete only when exposed. Agent mentions create execution through the existing webhook dispatch path; they do not grant the current chat Agent extra tools.

## Authoritative sources

- `apps/dashboard/docs/messages-and-mentions.md`
- `apps/dashboard/src/dashboard/features/messages/components/MessagesView.tsx`
- `apps/dashboard/app/api/kody/messages/route.ts`
- `apps/dashboard/app/api/kody/messages/[number]/route.ts`
- `apps/dashboard/app/api/kody/messages/read-state/route.ts`
