---
id: previews
title: Views and Previews
summary: Inspect saved environments, Fly previews, task deployments, page elements, and preview actions inside one browser workspace.
routes:
  - /preview
  - /preview/**
  - /fly/previews
  - /fly/machines
  - /fly/history
aliases:
  - views
  - preview
  - previews
  - browser
  - browser automation
  - website interaction
  - preview environment
  - element picker
  - fly preview
  - SSH
  - download SSH config
  - remote machine
---

# Views and Previews

## What this feature does

Views provides one browser workspace for Production, Staging, Development, external websites, Fly branch previews, and task Pull Request previews. It owns saved environment navigation, paths, viewport sizes, history, refresh, element inspection, macros, and preview-to-chat context. It prefers the Dashboard-owned Fly browser when available and retains the iframe path as a fallback. Related Fly surfaces show live preview apps, machines, and retained activity.

## When to use it

Use Views to inspect, discuss, or interact with a running website. For a requested website task, use a matching user-browser Capability and its declared actions; use task preview actions when reviewing a Pull Request. Use Fly preview inventory for live app status and machine management. Connections configures API-backed external accounts and does not create a browser session.

## Available actions and options

- Add, edit, remove, reorder, group, and switch named URL or branch environments stored per repository.
- Navigate paths and browser history, edit the address, refresh, and change desktop/mobile viewport sizes.
- Let Kody use a matching user-browser Capability to navigate, click, fill, upload, scroll, or wait within its declared origins and file roots.
- Inspect a visible element and send its URL, title, selection, DOM evidence, or screenshot context to Chat.
- Record, save, replay, and send inspector macros to Chat.
- Upload supported files through preview controls where the active environment enables it.
- Open, copy, refresh, or destroy tracked Fly previews; inspect live machines and activity.
- On `/fly/machines`, use **Download SSH config** beside a machine to download its OpenSSH settings and private login key. New machines using the SSH-enabled Kody images are configured during creation; there is no separate preparation or connection step in Kody. The download does not connect to the machine.
- For task Pull Request previews, inspect changes and comments and use available Approve, Fix, Cancel, or merge-related actions.

## Requirements and permissions

- The target must have a reachable preview URL or a resolvable Fly branch preview.
- Repository-shared environments require authenticated repository configuration access.
- Fly previews and machine actions require the repository's `FLY_API_TOKEN` and sufficient Fly permission.
- A user must sign in to an external website inside the visible browser; Connections credentials do not create or authorize that browser session.
- Element inspection requires the preview to be embeddable and the inspector/extension bridge to access the rendered page.
- Destructive task or machine actions require explicit confirmation and the corresponding live API permission.

## What will not work

- A site that blocks iframe embedding cannot be inspected inside Views.
- Connections does not create or authorize a browser session, and it has no browser-based connection option.
- Never invent a browser connection option or claim an action completed without a matching Capability and a successful live browser result.
- Cross-origin iframe security prevents direct DOM access without the inspector bridge.
- Saving an environment stores identity/configuration, not proof that its URL is currently healthy.
- A branch preview does not automatically disappear without the relevant lifecycle cleanup; PR-less previews need manual visibility and destruction.
- Approving a UI does not prove tests pass unless the real merge/CI path confirms it.
- Preview context cannot substitute for missing source files or live tool results.

## SSH downloads

Your personal Brain is listed using Personal Credentials, independently of the repository’s Fly setup. Other machines use the repository’s Fly credentials.

The downloaded ZIP contains a machine-specific folder with `config`, `identity`, `known_hosts`, and `README.txt`. On a Mac, place that folder in `~/.ssh/kody/` and add `Include ~/.ssh/kody/*/config` to `~/.ssh/config` once. Then select its host name in the desktop app’s SSH connections. Downloading alone does not install settings on the Mac. OpenSSH and openssl must be available locally.

The private key grants access to this machine; never paste it into chat. Kody never includes the Fly account token. Download requires verified login and authorized machine access; browser and Brain keys are limited to their owning user. Old machines without SSH configuration show the download button disabled. A custom image must include OpenSSH and the Kody startup hook. Do not claim the desktop app is connected merely because the download succeeded.

## Known limitations

- Iframe loading, authentication, cookies, Content Security Policy, and cross-origin behavior belong to the embedded application.
- Inspector and macro actions depend on the installed browser bridge and visible interactive state.
- Fly history is based on retained snapshots and estimated cost, not a billing authority.
- Signed Fly preview URLs may be refreshed rather than stored permanently.

## Common failures and recovery

- **Blank or refused iframe:** open the URL directly and verify embedding headers and authentication.
- **Element picker cannot inspect:** verify the extension/bridge is active and the page is reachable.
- **Fly preview unavailable:** verify token, app/machine state, branch identity, and preview configuration.
- **Saved environment is stale:** edit or remove it, then save the corrected repository configuration.
- **Action fails:** inspect the returned CI, Pull Request, or Fly error instead of assuming completion.

## Related tools and capabilities

Preview navigation and inspector tools may observe or act only when exposed. Runtime tools, signed tickets, repository writes, and Fly actions remain separate permission boundaries.

## Authoritative sources

- `apps/dashboard/docs/previews.md`
- `apps/dashboard/docs/element-picker.md`
- `apps/dashboard/src/dashboard/features/previews/components/PreviewBrowser.tsx`
- `apps/dashboard/src/dashboard/features/previews/components/PreviewWorkspace.tsx`
- `apps/dashboard/src/dashboard/features/previews/components/PreviewActions.tsx`
- `apps/dashboard/src/dashboard/features/previews/components/PreviewMacrosMenu.tsx`
- `apps/dashboard/src/dashboard/features/previews/components/FlyPreviewsList.tsx`
- `apps/dashboard/src/dashboard/features/previews/components/FlyMachinesTable.tsx`
