---
id: admin
title: Dashboard Administration
summary: Configure repository operations, content, Capabilities, Store assets, Fly runtimes, notifications, variables, organizations, setup flows, and backups.
routes:
  - /backend
  - /capabilities
  - /capabilities/**
  - /connections
  - /config
  - /content/**
  - /fly/**
  - /notifications
  - /org/**
  - /setup
  - /setup/**
  - /variables
  - /store-catalog
  - /store-catalog/**
aliases:
  - dashboard admin
  - backend backup
  - capabilities page
  - content management
  - cms
  - connections
  - facebook page connection
  - engine config
  - fly config
  - notifications
  - organization settings
  - store catalog
  - variables
---

# Dashboard Administration

## What this feature does

Administration groups several repository and tenant management surfaces. Each surface keeps its own source of truth; this guide is an index of the available options and their boundaries, not one shared admin data model.

## When to use it

Use these pages to configure or back up the Dashboard, manage executable definitions and Store activation, edit content, configure Engine or Fly behavior, route notifications, maintain non-secret variables, attach organization repositories, or run guided setup.

## Available actions and options

### Backend

- Export a JSON backup directly from the tenant's Convex database.
- Export the legacy GitHub backend for one-time migration.
- Import a supported dump into Convex and inspect the result.

### Capabilities

- List, search, inspect, create, edit, run, and remove local or activated Store Capabilities.
- Edit the complete folder: `instructions.md`, `contract.json`, optional `skills/`, and optional `tools/`.
- Choose `agent` or `script` execution. Script execution requires `tools/run.sh`, receives JSON input through environment variables, and must return exactly one JSON value.
- Configure declared input/output, trusted-script secret allowlist, timeout, and trust controls where supported.
- Store Capabilities are referenced assets; repository-specific changes require a local definition.

### Content

- Browse collections and entries; search, filter, paginate, create, read, edit, and delete entries when the active adapter permits.
- Define content models and fields.
- Configure the selected CMS adapter, schema, permissions, and MCP settings.
- Use built-in or configured remote adapters through the existing CMS contract.

### Connections

- Save external account metadata and references to credentials stored in Secrets.
- Facebook Page and Instagram professional connections store only account metadata and an access-token reference, then verify the account through the provider API.
- Instagram Creator and Business publishing is performed by the `publish-instagram-content` Workflow after explicit approval. Media must be available through a public HTTPS URL.
- Connections do not create browser sessions; website sessions and actions belong to Views.

### Engine configuration

- Manage repository operators, quality verification commands, comment aliases, allowed GitHub associations, and default branch.
- Save partial patches without overwriting unrelated `kody.config.json` fields.
- Configure models on `/models`, not `/config`; the Engine reads `agent.model`.

### Fly and Brain runtime

- Configure the repository Fly token, runner behavior, preview settings, and Repo Brain on Fly.
- Provision, refresh, suspend, resume, or destroy Repo Brain on Fly.
- List saved Brain images, select or apply a restore image, and inspect image state.
- List live preview, runner, Brain, and builder machines; suspend, resume, destroy, open, or copy supported targets.
- View retained Fly activity, uptime, suspend counts, and estimated cost.

### Notifications

- Create, edit, test, and delete Slack, Telegram, Discord, or generic webhook rules.
- Configure channel-specific destination and authentication fields.
- Follow the existing device-push and notification-routing documentation.

### Organization

- Inspect an organization, attach or remove repositories, refresh repository state, and navigate to one concrete repository.
- Read organization-wide summaries while requiring a concrete repository for writes.

### Store Catalog

- Browse, filter, search, inspect, install, and remove Solutions, Agents, Workflows, Capabilities, Loops, Commands, and Features.
- Inspect solution dependency trees and partial or installed status.
- Follow optional setup links after activation.
- Respect uninstall blockers when another installed item depends on an asset.

### Variables

- List visible non-secret values; create, edit, and delete uppercase variable names.
- Store strings, JSON, model catalogs, URLs, feature flags, and other reviewable configuration.
- Runtime reads may fall back to `process.env` unless explicitly disabled.

### Setup

- List registered setup wizards and open a selected wizard's guided run page.

## Requirements and permissions

- Repository-scoped administration requires an authenticated active repository and appropriate GitHub access.
- Convex runtime state stays in Convex; GitHub is used only for approved repository content, definitions, configuration, Store assets, and the selected GitHub CMS adapter.
- Capability scripts need a valid contract and executable `tools/run.sh`; requested secrets must be declared and available.
- CMS operations must satisfy the active adapter's schema, permissions, and credentials.
- Fly actions require the repository's `FLY_API_TOKEN` and matching Fly permission.
- Notification destinations require valid channel credentials and URLs.
- Variable names use uppercase letters, digits, and underscores, start with a letter, and are limited to 128 characters; values are non-empty and at most 64 KB.
- Destructive imports, removals, machine destruction, and content deletion require exact target confirmation.

## What will not work

- Backend import is not a blind universal restore; incompatible shapes or unauthorized tenant data must be rejected.
- A Capability cannot own its Agent, model, schedule, Workflow, or permission mode. Workflows select Agents; Loops own repeated activation.
- Store assets cannot be silently edited as local repository definitions.
- Installing a Store asset or importing a bundle does not prove it can execute.
- CMS cannot bypass its adapter, schema, permission, or remote-service limits.
- Connections cannot create a browser login, reuse a Views session, or publish content merely because an account and token were verified; a publishing Workflow must be run and approved.
- `/config` cannot set the Engine model through a top-level `model` field; that legacy shape is removed.
- Fly cannot be used without a per-repository token, and Fly setup is not required for the base GitHub Actions runner.
- Variables cannot safely store API keys, passwords, or tokens; use Secrets.
- Notification configuration cannot guarantee delivery when the destination, webhook, user preferences, or external provider rejects it.
- Organization-level context cannot authorize a write without one concrete target repository.
- Removing an installed Store dependency is blocked while another active asset requires it.

## Known limitations

- `admin` covers several separate domains; their individual runtime APIs remain authoritative.
- Backend backups and imports require version-compatible contracts and do not replace live verification.
- Fly activity cost is an estimate derived from retained snapshots, not the billing authority.
- Cross-instance caches may take their documented TTL to observe external writes.
- Optional CMS adapters and remote services may be unavailable even when their configuration is present.
- Setup wizards guide existing systems; they do not create parallel storage or execution owners.

## Common failures and recovery

- **Permission denied:** verify the signed-in identity, repository scope, and required GitHub or provider permission.
- **Capability cannot run:** validate its contract, entry point, tools, secret allowlist, Engine readiness, and live tool availability.
- **CMS operation rejected:** inspect adapter status, schema validation, credentials, and the exact collection or entry id.
- **Engine uses wrong model:** correct the model entry on `/models` and verify the written `agent.model` value.
- **Fly controls unavailable:** add or correct the repository's `FLY_API_TOKEN`, then refresh inventory.
- **Notification test fails:** verify destination-specific fields, network reachability, and provider response.
- **Variable value should be secret:** delete it from Variables and recreate it in the encrypted Secrets vault.
- **Store removal blocked:** remove or replace dependent installed assets first.
- **Import partly fails:** inspect item-level results; successful items are not rolled back automatically.

## Related tools and capabilities

Agents may use configuration, Capability, CMS, Store, notification, variable, and runtime tools only when present in the current tool index. Every overwrite must read the current value first. Guides explain options and constraints but never bypass authentication, confirmation, schemas, or runtime policy.

## Authoritative sources

- `apps/dashboard/docs/storage-backend.md`
- `apps/dashboard/docs/capabilities.md`
- `apps/dashboard/docs/cms.md`
- `apps/dashboard/docs/engine-config.md`
- `apps/dashboard/docs/runners.md`
- `apps/dashboard/docs/notifications.md`
- `apps/dashboard/docs/variables.md`
- `apps/dashboard/src/dashboard/features/admin/components/BackendManager.tsx`
- `apps/dashboard/src/dashboard/features/admin/components/CapabilitiesManager.tsx`
- `apps/dashboard/src/dashboard/features/admin/components/CmsManager.tsx`
- `apps/dashboard/src/dashboard/features/admin/components/ContentModelManager.tsx`
- `apps/dashboard/src/dashboard/features/admin/components/RepoConfigManager.tsx`
- `apps/dashboard/src/dashboard/features/admin/components/RunnerManager.tsx`
- `apps/dashboard/src/dashboard/features/admin/components/NotificationsManager.tsx`
- `apps/dashboard/src/dashboard/features/admin/components/OrgManager.tsx`
- `apps/dashboard/src/dashboard/features/admin/components/StoreCatalogManager.tsx`
- `apps/dashboard/src/dashboard/features/admin/components/VariablesManager.tsx`
