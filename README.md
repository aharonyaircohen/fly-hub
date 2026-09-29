# Fly Hub

Fly Hub is the Fly machine dashboard extracted from Kody Chat into this repository. It uses the original Fly runtime and machine management code to manage SSH machines, deploy password-protected apps, and review recent machine events.

Dashboard: [flyhub.thedigitalreality.app](https://flyhub.thedigitalreality.app)

## Sign in

Enter a Fly API token. Fly Hub verifies it with Fly and remembers it in an encrypted, HttpOnly browser cookie for 30 days. Use **Disconnect** to remove it. The token stays on the server during machine requests. The connected Fly organization determines which machines are visible.

The header offers **System**, **Light**, and **Dark** themes. Use the arrow icon there to disconnect. The dashboard pages are **Machines**, **Apps**, and **History**.

## Machines

Create an SSH machine with a name, size, region, and **Sleep when idle** choice. From Machines, download its SSH ZIP, suspend it, resume it, or destroy it. The dashboard also lists existing Kody-managed Fly machines available to the token.

History shows recent events reported by Fly for machines that still exist. Events for deleted machines are not retained by this dashboard.

## Apps

Open **Apps**, enter a public GitHub repository URL, and inspect the pinned commit and detected build plan. The first version supports repositories that can run without additional secrets. Deploy starts an asynchronous Fly build. Fly Hub creates a private runtime app and a public password gateway, then displays the app URL and a generated shared password. Copy the password when it appears: Fly Hub does not store its plaintext. **Reset password** issues a new one and invalidates previous app sessions.

The connected Fly organization must have an app builder host with the current `packages/fly/builder/Dockerfile` image available. The default host app is `kody-preview-builder`; set `FLY_HUB_BUILDER_HOST_APP` for a different host. Set `FLY_HUB_BUILDER_IMAGE` to an explicitly published image containing the password gateway code. Fly Hub refuses deployment when this setting is absent, so an older builder image cannot silently create an unprotected app. A build returns before the URL is usable, and the Apps page polls Fly for progress.

If the default host is absent, run `flyctl apps create <builder-app-name> --org <org-slug>` with a unique name and the organization shown in Fly Hub. Set `FLY_HUB_BUILDER_HOST_APP` to that name on the dashboard. From `packages/fly/builder`, run `flyctl deploy --build-only --push --image-label flyhub-password-v1 --app <builder-app-name> -c fly.toml --yes`. Set `FLY_HUB_BUILDER_IMAGE=registry.fly.io/<builder-app-name>:flyhub-password-v1` on the dashboard and deploy the dashboard. Use a new image label for later gateway changes. This publishes the builder image without starting a builder service machine.

## Chat and MCP

Fly Hub provides a remote MCP endpoint at `https://flyhub.thedigitalreality.app/api/fly-hub/mcp`. After signing in, open **Settings** in the sidebar, select **View machines**, **Manage machines**, and/or **Run commands** under MCP connection, and create a credential. Configure your MCP client with the server URL and the displayed bearer token. The token expires after 15 minutes and is shown only until you leave Settings. Return to Settings to issue another token. If the MCP client sends an `Origin` header from another site, add that exact origin to `FLY_HUB_MCP_ALLOWED_ORIGINS` (comma separated) in the Fly Hub server environment.

The MCP server exposes `flyhub_list_machines`, `flyhub_get_machine`, `flyhub_create_machine`, `flyhub_start_machine`, `flyhub_suspend_machine`, `flyhub_destroy_machine`, and `flyhub_run_command`. Management and command tools operate only on machines created in this organization's Fly Hub workspace. Creation uses a caller supplied UUID `requestId` for safe retries. Creation, destruction, and command execution require `confirm: true` in the tool call; configure the chat client to require human approval for these tools as well. A tool argument alone is not proof of human approval.

For apps, the chat tools are `flyhub_inspect_app`, `flyhub_deploy_app`, `flyhub_app_status`, `flyhub_list_apps`, and `flyhub_reset_app_password`. Inspection pins a public repository commit. Deployment requires that commit and `confirm: true`, returns a generated password once, and reports `building` until the status tool reports the URL ready. Password reset also requires `confirm: true`.

`flyhub_run_command` runs one noninteractive `/bin/sh -lc` command through the Fly Machines API. It requires a started machine, limits execution to 30 seconds, and returns at most 16 KiB of each output stream. It never returns Fly tokens or SSH private keys. Action audit records are written to server logs with the grant ID, target, outcome, and a hash of the command, not the command text. The MCP bearer contains an encrypted Fly token, so treat it as a secret until expiry. Disconnecting the browser session does not revoke an already issued credential; it expires after 15 minutes.

## Local development

Run `pnpm install --frozen-lockfile`, set `KODY_MASTER_KEY` in `apps/dashboard/.env.local`, then run `pnpm --filter kody-dashboard dev`. Open `http://localhost:3333/` and enter a Fly token. `KODY_MASTER_KEY` encrypts the remembered session and SSH settings. To develop the copied Kody features, additional environment variables may be needed.

New SSH machines use the published `ghcr.io/aharonyaircohen/flyhub-browser:latest` image because it contains OpenSSH. `FLY_HUB_MACHINE_IMAGE` can override it only with an image that includes `/usr/sbin/sshd` and can run `/etc/kody-ssh/start.sh`. Set `FLY_HUB_MACHINE_SSH_USER` if that image uses another user.

## Verification

- `pnpm verify` checks types, lint, unit tests, and builds.
- `PW_LOCAL=1 pnpm --filter kody-dashboard exec playwright test tests/e2e/fly-hub-shell.spec.ts tests/e2e/fly-hub-pages.spec.ts tests/e2e/fly-ssh-download.spec.ts --project=chromium --workers=1` tests the mounted local UI.
- `packages/fly/tests/live/managed-machine-lifecycle.spec.ts` exercises the Fly lifecycle using disposable apps. See [lifecycle results](docs/lifecycle-test-results.md).
