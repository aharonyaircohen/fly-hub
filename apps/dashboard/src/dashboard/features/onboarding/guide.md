---
id: onboarding
title: Onboarding
summary: Authenticate a new user and start the repository-free guided Chat onboarding flow.
routes:
aliases:
  - onboarding
  - first run
  - welcome to kody
  - start private chat
---

# Onboarding

## What this feature does

Onboarding is the repository-free first-run path. It validates a GitHub personal access token, signs the user into the Dashboard, and opens Chat once with the built-in onboarding Guided Flow. Chat provides the guidance; the page provides only the authentication action.

## When to use it

Use it for a user who has not signed in or attached a repository and wants to start a private Kody conversation before configuring repository tools.

## Available actions and options

- Enter a GitHub personal access token.
- Validate the token against the authentication endpoint.
- Sign in as the resolved GitHub user.
- Start private Chat with the onboarding Guided Flow exactly once.
- Attach or select a repository later when repository tools are needed.

## Requirements and permissions

- A valid GitHub personal access token is required.
- The token must resolve an authenticated GitHub identity.
- Later repository operations require the scopes and repository access needed by those operations.
- The token is entered through a password field and must not be repeated in chat content.

## What will not work

- Onboarding cannot provide repository tools before a repository is attached.
- A GitHub login does not automatically install Kody Engine or configure models, secrets, or Fly.
- An invalid or expired token cannot start Chat.
- The welcome page is not a second onboarding editor; Chat owns the guided experience.

## Known limitations

- The initial page offers one sign-in path.
- Repository access and tool availability are established later and may require more token scopes.
- Completing the Guided Flow is not proof that Engine execution works.

## Common failures and recovery

- **Invalid GitHub token:** create or correct the token, then submit again.
- **Authenticated but repository tools are unavailable:** attach a repository and grant the required scopes.
- **Engine actions unavailable later:** run Engine Setup for the selected repository.

## Related tools and capabilities

The onboarding Guided Flow can explain next steps but cannot bypass authentication, repository selection, or tool permissions.

## Authoritative sources

- `apps/dashboard/src/dashboard/features/onboarding/components/WelcomeSetup.tsx`
- `packages/kody-chat-dashboard/src/dashboard/lib/guided-flows/builtins/onboarding.ts`
- `apps/dashboard/app/api/kody/auth/me/route.ts`
