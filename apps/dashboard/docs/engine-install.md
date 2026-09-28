# /init — engine install

`/init` (chat slash-command, or `POST /api/kody/engine/install`) wires
a consumer repo up so Kody can run inside its GitHub Actions runner.
One call, idempotent.

## What it does

In order, against the connected repo (`owner/repo` from the dashboard
auth headers):

1. **Pulls the canonical workflow** — `templates/kody.yml` from
   `@kody-ade/kody-engine@latest` on unpkg.
2. **Commits the workflow** to `.github/workflows/kody.yml`.
   - File absent → create (`chore(kody): install engine workflow`).
   - File present and matches latest → no commit.
   - File present and differs → update (`chore(kody): sync engine workflow to latest template`).
   - `force: true` always commits.
3. **Creates or updates `kody.config.json`** without replacing unrelated
   repo settings. If an engine model is configured in the dashboard, `/init`
   writes it to `agent.model`.
4. **Writes `KODY_TOKEN`** as a compatibility secret when the caller's PAT
   can manage Actions secrets. It is optional: the engine falls back through
   PAT, GitHub App credentials, and finally GitHub's built-in token.
5. **Keeps user secrets in Kody's encrypted vault.** The workflow uses its
   short-lived GitHub OIDC identity to request only the secrets declared by
   the running capability. `KODY_MASTER_KEY` remains on the Dashboard server;
   it is never copied to the repository or runner.
6. **Registers the dashboard webhook** at
   `<dashboard-base>/api/webhooks/github` so push-based cache
   invalidation works. Registration requires a public HTTPS dashboard URL;
   local and private URLs skip this step without calling GitHub.

The compatibility token write and webhook registration are **soft-fail**:
their failures appear in `nextSteps` and `summary` without undoing the
workflow/config install.

## Verify the setup

Check the connected repo, not only the dashboard:

1. Confirm the repo contains `.github/workflows/kody.yml` and
   `kody.config.json` on its default branch.
2. Confirm the dashboard has an enabled engine/default model and that the
   model's API-key secret exists under **Settings → Secrets**.
3. In chat, select **Kody Live** and send a read-only request such as:
   `Reply with this repo's name and current branch. Do not edit files.`
4. Wait for Kody Live to become ready and return the answer. Then confirm the
   matching Kody workflow run completed successfully in the repo's
   **GitHub Actions** tab.

The files prove that Kody was installed. The completed read-only run proves
that the workflow, model, credentials, and dashboard event path work together.

## Repair a missing or broken setup

In the connected repo's dashboard chat, send `/init` by itself. The command is
idempotent: it creates or updates the workflow and config, refreshes compatible
Kody authentication, and refreshes the webhook without replacing unrelated
`kody.config.json` settings.

Read the full `/init` summary and complete every item under `nextSteps`.
An `ok: true` response means the workflow/config install succeeded; secret and
webhook steps can still have soft failures. After resolving them, re-run
`/init`, then repeat the Kody Live verification above.

`/init` cannot invent an LLM model or provider key. Configure those in the
dashboard first if they are missing.

## Inputs

```
POST /api/kody/engine/install
Headers: x-kody-token, x-kody-owner, x-kody-repo
Body:    { "force"?: boolean }
```

`x-kody-token` authorizes the installer itself. A fine-grained PAT needs these
repository permissions:

- **Contents: Read and write** — to commit the workflow and config.
- **Secrets: Read and write** — optional, for the compatibility `KODY_TOKEN`.
- **Webhooks: Read and write** — to register the dashboard webhook.

For a classic PAT, use the corresponding repository access plus
`admin:repo_hook` for webhook registration.

If **Secrets: Read and write** is missing, the workflow still lands and can
use the built-in GitHub token. User vault secrets never require this
permission.

## Outputs

```ts
{
  ok: true,
  workflow:        { action: 'created' | 'updated' | 'unchanged', ... },
  kodyTokenSecret: { ok: boolean, name: 'KODY_TOKEN', error? },
  runtimeSecrets:  { source: 'kody-vault', authentication: 'github-oidc' },
  webhook:         { ok: boolean, skipped?, created?, hookId?, error?, status?, detail? },
  nextSteps:       string[],   // user-facing follow-ups
  summary:         string      // one-line human summary
}
```

## When to re-run

Re-run `/init` (or POST with `force: true`) whenever:

- The `kody.yml` template changes upstream (new engine version with
  workflow tweaks).
- The PAT is rotated and the previous `KODY_TOKEN` is no longer valid.

## Vault runtime access

The engine runs inside the consumer repo's GitHub Actions runner. GitHub OIDC
identifies the repo to Kody's backend, so consumer repos do not need a database
key or mirrored user secrets. The Dashboard verifies that the OIDC token was
issued for that repository's `.github/workflows/kody.yml`, decrypts the
repository-scoped vault, and returns only the requested secret.

## Files

- `app/api/kody/engine/install/route.ts` — HTTP entry point.
- `src/dashboard/lib/engine/install.ts` — `installEngine()`.
- `app/api/kody/engine/secret/route.ts` — OIDC-authenticated runtime access.
- `src/dashboard/lib/backend/github-actions-identity.ts` — workflow identity verification.
- `src/dashboard/lib/webhooks/register.ts` — `ensureWebhook()`.
- `templates/kody.yml` (in `@kody-ade/kody-engine`) — workflow template.
