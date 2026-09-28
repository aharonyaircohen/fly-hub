# QA guide

Test the requested behavior from the user's point of view. Use judgment to
choose the environment, journeys, risks, and depth that fit the change.

Use the connected repository's available context when needed. Non-sensitive
test information may come from Kody Variables. Sensitive test information may
come from Kody Secrets, unlocked only inside the trusted runtime using
`KODY_MASTER_KEY`. Never expose secret values in test output or reports.

When QA needs application authentication, use this convention:

- `LOGIN_USER` — Kody Variable containing the dedicated QA account email.
- `LOGIN_PASSWORD` — Kody Secret containing its password.

The engine signs in and prepares an authenticated browser session before QA
starts. The QA agent receives the session, not `LOGIN_PASSWORD` or
`KODY_MASTER_KEY`. If the login fails, the Quality run is blocked rather than
testing only public pages and reporting success.

QA password provisioning must finish through Convex's service-key-protected
`/internal/qa/reset-password` endpoint. This creates the password hash in the
same HTTP runtime that verifies deployed logins; the plaintext password remains
in Kody Secrets and is never returned by the endpoint.

Verify the real result, not only the implementation or automated checks. Report
what was tested, what happened, useful evidence, and anything that remains
uncertain or blocked.

See [Variables](./variables.md) and [Secrets vault](./secrets-vault.md) for
configuration details.
