# Fly Hub

Fly Hub is the Fly machine dashboard extracted from Kody Chat into this repository. It uses the original Fly runtime and machine management code, with a smaller dashboard for creating machines, downloading SSH settings, viewing live machines, and seeing recent machine events.

Dashboard: [flyhub.thedigitalreality.app](https://flyhub.thedigitalreality.app)

## Sign in

Enter a Fly API token. Fly Hub verifies it with Fly and remembers it in an encrypted, HttpOnly browser cookie for 30 days. Use **Disconnect** to remove it. The token stays on the server during machine requests. The connected Fly organization determines which machines are visible.

## Machines

Create an SSH machine with a name, size, region, and **Sleep when idle** choice. From Machines, download its SSH ZIP, suspend it, resume it, or destroy it. The dashboard also lists existing Kody-managed Fly machines available to the token.

History shows recent events reported by Fly for machines that still exist. Events for deleted machines are not retained by this dashboard.

## Local development

Run `pnpm install --frozen-lockfile`, set `KODY_MASTER_KEY` in `apps/dashboard/.env.local`, then run `pnpm --filter kody-dashboard dev`. Open `http://localhost:3333/` and enter a Fly token. `KODY_MASTER_KEY` encrypts the remembered session and SSH settings. To develop the copied Kody features, additional environment variables may be needed.

New SSH machines use the published `ghcr.io/aharonyaircohen/flyhub-browser:latest` image because it contains OpenSSH. `FLY_HUB_MACHINE_IMAGE` can override it only with an image that includes `/usr/sbin/sshd` and can run `/etc/kody-ssh/start.sh`. Set `FLY_HUB_MACHINE_SSH_USER` if that image uses another user.

## Verification

- `pnpm verify` checks types, lint, unit tests, and builds.
- `PW_LOCAL=1 pnpm --filter kody-dashboard exec playwright test tests/e2e/fly-hub-shell.spec.ts tests/e2e/fly-hub-pages.spec.ts tests/e2e/fly-ssh-download.spec.ts --project=chromium --workers=1` tests the mounted local UI.
- `packages/fly/tests/live/managed-machine-lifecycle.spec.ts` exercises the Fly lifecycle using disposable apps. See [lifecycle results](docs/lifecycle-test-results.md).
