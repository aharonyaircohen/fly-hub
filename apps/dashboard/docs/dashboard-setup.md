# Dashboard setup

The dashboard manages your per-repo definitions in the Kody backend, scoped to
the connected GitHub repository and edited through dashboard pages. The Engine
hydrates those definitions into a disposable consumer checkout at run time;
they are not normally committed to the consumer repository. Company Store
assets remain read-only files in the Store repository.

There is exactly **one** required server-side env var: `KODY_MASTER_KEY`,
which unlocks the encrypted vault. See
[Secrets vault → One-time setup](./secrets-vault.md#one-time-setup) for
how to generate and install it. Everything else on this page is edited
through the dashboard once you're logged in.

## Stores at a glance

| Store            | Page            | Current storage                             | Secret?               | Doc                                                       |
| ---------------- | --------------- | ------------------------------------------- | --------------------- | --------------------------------------------------------- |
| **Agents**       | `/agent`        | Kody backend definition bundle              | No (plaintext)        | [Agents & Capabilities](./concepts/staff-capabilities.md) |
| **Capabilities** | `/capabilities` | Kody backend `capability:<slug>` definition | No (plaintext)        | [Agents & Capabilities](./concepts/staff-capabilities.md) |
| **Commands**     | `/commands`     | Kody backend `command:<slug>` documents     | No (plaintext)        | [Commands](./commands.md)                                 |
| **Secrets**      | `/secrets`      | Kody encrypted vault record                 | **Yes** (AES-256-GCM) | [Secrets vault](./secrets-vault.md)                       |
| **Variables**    | `/variables`    | Kody backend `variables` document           | No (plaintext)        | [Variables](./variables.md)                               |
| **Context**      | `/context`      | Kody backend `context:<slug>` documents     | No (plaintext)        | [Context](./context.md)                                   |

Each store is per-repo: switch the connected repo and you're editing a
different tenant. Runtime hydration creates `.kody-engine/definitions/` in the
consumer checkout; that cache is disposable and is not written back to GitHub.

## What goes where

### Agents — `/agent`

Identity-only personas: an agent file says _who_ an agent is (role voice,
values, allowed commands, restrictions) and nothing about _what_ it does
or _when_ it runs. Capability contracts reference an agent member by slug; the engine
injects the agent ahead of the capability body at run time. Keep these pure
identity — no tasks, schedules, or implementation recipes. See
[Agents & Capabilities](./concepts/staff-capabilities.md).

### Capabilities — `/capabilities`

A capability folder contains the required `instructions.md` plus optional
`contract.json`, `skills/`, and `tools/`. It owns the reusable behavior and its
input/output contract; it does not own an Agent, Workflow, Loop, model, or
schedule. Older `capability.md`/`definition.json` and implementation-profile
folders still load only as Engine compatibility formats while repos migrate.
See
[Agents & Capabilities](./concepts/staff-capabilities.md).

### Commands — `/commands`

Slash commands for the chat composer. Repo commands are stored in the Kody
backend as `command:<slug>` documents and merge with the shipped built-ins (`/plan`,
`/research`, `/review`, …); a repo command wins on slug collision. Bodies
support `$ARGUMENTS` / `$0` / `$1` substitution and work identically
across all chat backends. See [Commands](./commands.md).

### Secrets — `/secrets`

The encrypted vault: API keys, passwords, tokens — anything sensitive a
dashboard request reads at run time. Stored as one AES-256-GCM blob in
`backend vault record`; values are never displayed after saving. This is
the **only** store that needs `KODY_MASTER_KEY`. See
[Secrets vault](./secrets-vault.md).

### Variables — `/variables`

The plaintext sibling of the vault: non-secret config you'd be fine
seeing in a PR diff — model lists, feature flags, target URLs,
usernames. Stored as readable JSON in `backend variables record`. Put keys
and passwords in Secrets, not here. See [Variables](./variables.md).

### Context — `/context`

Free-form markdown context about your product/company is stored in the Kody
backend as `context:<slug>` — the kind of background you'd brief a new
teammate with. The dashboard injects the matching entries into chat and
agent context so answers are grounded in your domain. See
[Context](./context.md).

## End-to-end: set up QA

> **Pending.** Sourcing QA config from Variables + Vault + Context (in
> place of the old `backend-managed resources/qa-guide.md`) depends on an engine change
> (kody-engine commit `5024a0a`) being published **and** a per-repo
> migration. Until that lands for your repo, these steps are
> aspirational. See [QA automation](./qa.md) for status and detail.

Once the engine change is live, configuring QA is entirely
dashboard-managed — no env vars, no hand-edited files:

1. **Variables** (`/variables`) — set the QA targeting knobs:
   - `QA_URL` — the site the QA agent browses.
   - `LOGIN_USER` — the test-account username.
2. **Secrets** (`/secrets`) — set the one sensitive value:
   - `LOGIN_PASSWORD` — the test-account password (encrypted; never
     goes in Variables).
3. **Context** (`/context`) — write the QA scenarios and key routes so
   the agent knows what to exercise and what "correct" looks like.
4. **Capabilities** (`/capabilities`) — enable the two QA capabilities by flipping
   `disabled: false`:
   - `qa` — the targeted QA pass.
   - `qa-sweep` — the broad, no-scope exploratory sweep.

That's the whole loop: targeting in Variables, the secret in the vault,
the playbook in Context, and the schedule in capability contracts. The engine reads
all four at tick time. Full walkthrough and the migration steps live in
[QA automation](./qa.md).
