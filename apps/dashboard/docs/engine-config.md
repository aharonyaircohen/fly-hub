# Engine config

The dashboard's **/config page** edits the Kody engine's behavior by writing
fields into the consumer repo's **`kody.config.json`** — the operator inbox
list, the verification commands Kody runs on its own work, the `@kody` access
gate, the base branch, and comment aliases. It edits **engine config only**:
secrets live in the encrypted vault ([./secrets-vault.md](./secrets-vault.md)),
non-secret runtime values in Variables ([./variables.md](./variables.md)), and
the engine's model is set on /models. The page is repo-scoped — whatever
applies, applies to everyone working in the connected repo.

`kody.config.json` lives on the repo's **default branch**, not `Kody backend`.
The engine's machine-written state (jobs and activity) commits to the
`Kody backend` branch, but config is human-authored and read off `main`. Every
read and write here goes through the GitHub Contents API with no `ref`, so it
always targets the default branch.

## The pieces

| Piece                      | What it is                                                                                                                                 | Where                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **/config page**           | Repo-scoped engine config entry point. Renders the Operators card plus the four engine-config cards. AuthGuard-gated.                      | [`../app/(chat-rail)/config/page.tsx`](<../app/(chat-rail)/config/page.tsx>)                                     |
| **RepoConfigManager**      | Page shell. Composes `OperatorsCard` + `EngineConfigCards`. Distinct from /company, which is now only bundle import/export.                | [`../src/dashboard/lib/components/RepoConfigManager.tsx`](../src/dashboard/lib/components/RepoConfigManager.tsx) |
| **Operators card**         | Edits `github.operators` — the inbox routing list. Its own GET/PUT route, not the shared config patch.                                     | [`../src/dashboard/lib/components/OperatorsCard.tsx`](../src/dashboard/lib/components/OperatorsCard.tsx)         |
| **Engine config cards**    | Four cards — quality commands, access gate, default branch, comment aliases — sharing one `useEngineConfig` load and a partial-patch save. | [`../src/dashboard/lib/components/EngineConfigCards.tsx`](../src/dashboard/lib/components/EngineConfigCards.tsx) |
| **`config.ts`**            | Read/cache/merge-write of `kody.config.json`. Owns the merge-not-overwrite contract and the legacy-`model`-strip. Pure, server-side.       | [`../src/dashboard/lib/engine/config.ts`](../src/dashboard/lib/engine/config.ts)                                 |
| **`useEngineConfig` hook** | Loads the editable slice once and exposes `save(patch)`; the server returns the merged result, which becomes new state.                    | [`../src/dashboard/lib/engine/useEngineConfig.ts`](../src/dashboard/lib/engine/useEngineConfig.ts)               |

## What lives in `kody.config.json`

The engine reads a handful of top-level keys. The dashboard splits editing
across three pages by concern — /config owns the repo-wide behavior fields:

| Field                                               | What it controls                                                                                                                | Edited on                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `github.operators`                                  | GitHub logins recommendation capabilities @-mention so their comment routes into the dashboard inbox. Empty = nobody is tagged. | **/config** → Operators card   |
| `quality.{typecheck,lint,format,testUnit}`          | Commands the engine runs to verify the code it produces. Blank/absent = skip that check.                                        | **/config** → Quality commands |
| `access.allowedAssociations`                        | GitHub author associations allowed to trigger `@kody` (OWNER/MEMBER/…). Empty = engine default (team only).                     | **/config** → Access gate      |
| `git.defaultBranch`                                 | Base branch new work branches off and targets. Blank = engine default (`main`).                                                 | **/config** → Default branch   |
| `aliases`                                           | Word → subcommand map, e.g. `{ "build": "run" }` lets `@kody build` dispatch `run`.                                             | **/config** → Comment aliases  |
| `agent.model`                                       | The `provider/model` selection the engine runs.                                                                                  | /models (synced on save)       |
| `agent.modelConfig`                                 | Non-secret endpoint and credential-name metadata for a fixed custom model.                                                      | /models (synced on save)       |
| `agent.perImplementation`                           | Legacy config field for per-capability model overrides, e.g. `{ "research": "anthropic/claude-opus-4-7" }`.                     | /models                        |
| `defaultImplementation` / `defaultPrImplementation` | Legacy config fields for the bare `@kody` capability action on an issue / PR (engine defaults: `classify` / `fix`).             | /config                        |
| `company.activeWorkflows`                           | Store workflow slugs linked into this repo. Removing a Store workflow clears this link, not the Store asset.                    | /workflows and /store-catalog  |

## The Operators card — inbox routing

`github.operators` is the **only** thing that gets a recommendation into the
dashboard inbox. CTO/pr-health capabilities post their recommendation as a GitHub
comment whose first line `@`-mentions an operator; that mention is what routes
it inbound. An empty list means recommendations still post on GitHub but reach
nobody — so the card warns when the list is blank, and an
`OperatorsWarningBanner` links here from elsewhere in the app.

The list is the agency's **explicit** choice — never auto-filled from
collaborators. Add/remove handles in the card; each handle is normalized
server-side (`@`-stripped, trimmed, de-duped case-insensitively, order
preserved) before write. It has its own
[`/api/kody/company/operators`](../app/api/kody/company/operators/route.ts)
GET/PUT route rather than riding the shared config patch.

## The engine config cards — verify, gate, branch, alias

Four cards share one `useEngineConfig` instance: it loads the editable slice
once via GET `/company/config`, and each card edits its own part and calls
`save(patch)` with just that slice. The server merges the patch into the live
file and returns the merged result, which replaces client state — so two cards
edited in the same session never clobber each other.

- **Quality commands** — four free-text command fields (`typecheck`, `lint`,
  `format`, `testUnit`). Leaving one blank clears that check; the engine then
  skips it. Bounded to 500 chars each so a fat-fingered paste can't bloat the
  blob.
- **Access gate** — toggle chips over the GitHub author associations. None
  selected reverts to the engine default (OWNER/MEMBER/COLLABORATOR — team
  only); add `NONE` / `CONTRIBUTOR` to open `@kody` to outside commenters. The
  card shows the currently-effective set.
- **Default branch** — a single text field. Blank shows and means the engine
  default (`main`).
- **Comment aliases** — add/remove `word → capability action` pairs. Built-in aliases
  (e.g. `build → run`) always apply regardless of what's listed here.

## Write flow

```
┌──────────────┐   edit one slice   ┌─────────────────────────────┐
│ a config card│───────────────────▶│ save(patch)  (one card's     │
│ (/config)    │                    │  fields only)                │
└──────────────┘                    └──────────────┬───────────────┘
       ▲                                           │ PATCH /company/config
       │ merged result → new state                 ▼   (or PUT /company/operators)
       │                          ┌─────────────────────────────────┐
       │                          │ writeConfigPatch → mutateConfig  │
       │                          │  1. read current kody.config.json│
       │                          │     (default branch, tolerate    │
       │                          │      404 + corrupt JSON)         │
       │                          │  2. spread existing, apply patch │
       │                          │  3. delete legacy top-level model│
       │                          │  4. commit + invalidate cache    │
       │                          └──────────────┬──────────────────┘
       │  force-read merged result                ▼
       └───────────────────────────│ kody.config.json @ default branch│
                                   └───────────────────────────────────┘
```

Every writer — `writeConfigPatch`, `writeOperators`, `writeEngineModel`,
`writeDefaultImplementation` — funnels through `mutateConfig`, so the
merge-not-overwrite rule (never clobber the engine's required keys: `github`,
`implementations`, `quality`, …) lives in exactly one place. A fresh file is
seeded with the engine's minimum (`implementations`, `github`). Reads cache for
60s; writes invalidate the cache immediately so a follow-up read sees the
change.

## The model is special — `agent.model`, not `model`

The engine selects with **`agent.model`** and uses `agent.modelConfig` only for
the selected model's non-secret runtime details, such as a custom endpoint and
vault key name. There is **no `model.default` and no top-level
`model` field** — `mutateConfig` actively deletes any top-level `model` key on
every write, because the engine never read it. Do not reintroduce it.

The model is not edited on /config — it's set on /models, which keeps its own
"Default for engine" flag (`engineDefault`) separate from the chat default. On
save, the models route picks the engine-default entry, derives its spec via
`engineModelSpec`, and syncs it into `agent.model` (skipping the commit when
unchanged). `engineModelSpec` prefers the entry **`id`** when it's already in
`provider/model` form — so non-preset providers must spell their `id`
correctly:

- **`google`** → LiteLLM wants `gemini/…`, not `google/…`. Set the `id` to
  `gemini/<model>`.
- **`custom`** → no provider prefix is derivable; set the `id` to the real
  `provider/model`.
- Other presets (`anthropic`, `openai`, `groq`, `mistral`, `deepseek`, `xai`,
  `openrouter`) match LiteLLM's names, so the auto-built `provider/modelName`
  is fine.

See [./models.md](./models.md) for the full model picker. The link between the
two pages is one-directional: editing /config never touches the model;
saving /models writes `agent.model` (and the legacy `agent.perImplementation`
override map).

## File reference

| File                                                                                                             | Purpose                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`../app/(chat-rail)/config/page.tsx`](<../app/(chat-rail)/config/page.tsx>)                                     | /config page entry (AuthGuard + RepoConfigManager)                        |
| [`../src/dashboard/lib/components/RepoConfigManager.tsx`](../src/dashboard/lib/components/RepoConfigManager.tsx) | Page shell composing the cards                                            |
| [`../src/dashboard/lib/components/OperatorsCard.tsx`](../src/dashboard/lib/components/OperatorsCard.tsx)         | `github.operators` editor                                                 |
| [`../src/dashboard/lib/components/EngineConfigCards.tsx`](../src/dashboard/lib/components/EngineConfigCards.tsx) | Quality / access / branch / aliases cards                                 |
| [`../src/dashboard/lib/engine/config.ts`](../src/dashboard/lib/engine/config.ts)                                 | Read/cache/merge-write of `kody.config.json`; `engineModelSpec` consumers |
| [`../src/dashboard/lib/engine/useEngineConfig.ts`](../src/dashboard/lib/engine/useEngineConfig.ts)               | Hook: load slice + partial-patch save                                     |
| [`../app/api/kody/company/config/route.ts`](../app/api/kody/company/config/route.ts)                             | GET/PATCH for quality, aliases, access, branch, perImplementation         |
| [`../app/api/kody/company/operators/route.ts`](../app/api/kody/company/operators/route.ts)                       | GET/PUT for `github.operators`                                            |
| [`../app/api/kody/models/route.ts`](../app/api/kody/models/route.ts)                                             | /models route; syncs `agent.model` on save                                |
| [`../src/dashboard/lib/variables/models.ts`](../src/dashboard/lib/variables/models.ts)                           | `engineModelSpec` / `pickEngineDefaultModel`                              |

## FAQ

**Where does `kody.config.json` live — `main` or `Kody backend`?**

The default branch (`main`). Config is human-authored; only machine-written
state (jobs and activity) goes to `Kody backend`. Reads and writes here use
the Contents API with no `ref`, which always targets the default branch.

**I picked a model on /models but the engine still runs the old one.**

Check the entry's `id`. `engineModelSpec` uses the `id` when it contains a
`/`, so a `google` entry needs `id: gemini/<model>` (LiteLLM's name) and a
`custom` entry needs an explicit `provider/model` id. A wrong id writes a
spec the engine can't resolve.

**Why does /config exist separately from /company?**

The config editors used to sit on the Company (import/export) page, which read
as misleading. The `refactor(config): move engine config to its own /config
page` commit moved them to a dedicated repo-scoped /config page; /company is
now purely bundle import/export.

**My inbox is empty even though capabilities run.**

`github.operators` is probably unset. Recommendations only reach the inbox by
@-mentioning an operator, and that list is company-set, never auto-filled. Add
your handle in the Operators card; the card warns when the list is blank.

**Does editing one card overwrite another card's field?**

No. Each card saves only its own slice as a partial patch; `mutateConfig`
spreads the existing file and applies just the patched keys, so untouched
fields survive. The merge-not-overwrite contract is enforced in one place
(`mutateConfig`).

**What happened to a top-level `model` key?**

It never existed in the engine. `mutateConfig` deletes any top-level `model`
on every write as a guard against the legacy shape. The engine reads only
`agent.model`.
</content>
</invoke>
