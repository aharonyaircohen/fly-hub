# Agent instructions — build a Kody Chat plugin in a consumer repo

> **Audience: an AI agent** working inside a business consumer's GitHub
> repository. Follow these instructions exactly to construct a chat plugin
> that adds server-executed tools to that client's Kody chat. A human is not
> expected to hand-write any of this — you build it end to end.

## What you are building

A `kody-plugin/` directory at the repo root. The Kody platform discovers it
by convention, validates it against the schema below, and loads its tools
into the client's chat at session start. Nothing outside `kody-plugin/`
is read by the loader.

```
kody-plugin/
  manifest.json          # identity + declared tools (pure data, no code)
  tools/
    <tool-name>.ts       # one file per tool — definition + handler
  package.json           # deps for handlers (keep minimal)
  README.md              # one paragraph: what this plugin adds and why
```

## Step 1 — manifest.json

Pure JSON, no comments. Every tool you ship MUST be declared here; the
loader refuses tools found on disk but missing from the manifest (and vice
versa).

```json
{
  "spec": 1,
  "id": "<kebab-case plugin id, unique per repo, e.g. acme-crm>",
  "description": "One sentence: what this plugin lets the chat do.",
  "capabilities": ["tools"],
  "tools": [
    {
      "name": "<snake_case tool name, prefixed with plugin id, e.g. acme_crm_lookup_order>",
      "description": "One sentence the chat model reads to decide when to call this.",
      "file": "tools/lookup-order.ts"
    }
  ]
}
```

Rules:
- `spec` is always `1`.
- `capabilities` is always exactly `["tools"]` — consumer plugins may only
  contribute server tools. Do not declare `slots`, `theme`, `middleware`,
  or any other capability; the loader rejects them.
- Tool `name` must be globally unique-ish: ALWAYS prefix with the plugin id
  (`acme_crm_*`). Name collisions with platform tools fail the whole load.
- 10 tools maximum per plugin. If the client needs more, stop and report —
  that is a design smell, not a limit to work around.

## Step 2 — one file per tool

Each tool file default-exports a definition matching this contract (this is
the consumer-repo mirror of the platform's `ChatPluginToolDefinition`):

```ts
import { z } from "zod";
import type { KodyToolContext } from "@kody-ade/plugin-sdk";

export default {
  description: "Look up an order by id and return status + line items.",
  inputSchema: z.object({
    orderId: z.string().min(1).describe("The order id, e.g. ORD-1234"),
  }),
  async execute(input: { orderId: string }, ctx: KodyToolContext) {
    // input is ALREADY validated against inputSchema before this runs.
    const res = await fetch(`${ctx.env.ACME_API_URL}/orders/${input.orderId}`, {
      headers: { Authorization: `Bearer ${ctx.env.ACME_API_KEY}` },
    });
    if (!res.ok) {
      // Throw a plain Error with a user-safe message. Never include
      // secrets, stack traces, or raw upstream bodies.
      throw new Error(`Order lookup failed (${res.status})`);
    }
    return await res.json(); // any JSON-serializable value
  },
};
```

Hard rules for handlers:
- **Zod input schema is mandatory.** Every field gets `.describe(...)` so
  the chat model knows how to fill it. Validate everything; trust nothing.
- **Secrets come only from `ctx.env`** — the per-brand secret store the
  operator fills in the Kody admin UI. NEVER hardcode keys, tokens, URLs
  with embedded credentials, or customer data in the repo. If a handler
  needs a secret, list it in the README and reference it via `ctx.env.<NAME>`.
- **Handlers run sandboxed** with network access but no filesystem access
  and a 20-second budget. Do not spawn processes, read files, or hold state
  between calls — module-level state is not preserved.
- **Return small JSON.** The return value goes into the model's context;
  keep it under ~10 KB. Summarize or paginate large upstream responses.
- **Read-only by default.** A tool that mutates external state (creates,
  updates, sends, deletes) must say so in its `description` starting with
  the word `WRITE:` — the platform uses this to gate confirmation.
- Errors: throw `Error` with a short user-friendly message; log nothing to
  stdout/stderr (there is no console in the sandbox).

## Step 3 — package.json

```json
{
  "name": "kody-plugin",
  "private": true,
  "type": "module",
  "dependencies": {
    "zod": "^3.23.0",
    "@kody-ade/plugin-sdk": "^1.0.0"
  }
}
```

Keep dependencies to these two unless a handler genuinely needs more; every
extra dependency slows load and widens the audit surface.

## Step 4 — verify before you finish

1. `npx @kody-ade/plugin-sdk validate ./kody-plugin` — schema-checks the
   manifest, compiles each tool file, and confirms manifest ↔ files match.
2. `npx @kody-ade/plugin-sdk test ./kody-plugin` — runs each tool once with
   schema-derived sample input against stub env vars; a tool may fail on
   missing real secrets, but it must fail with a clean thrown Error, not a
   crash.
3. Confirm the security checklist: no hardcoded secrets, all inputs
   zod-validated, WRITE-prefixed descriptions on mutating tools, returns
   under 10 KB.

Do not open a PR with a plugin that fails step 1 or 2.

## Step 5 — hand off

Open a PR titled `feat: kody chat plugin <id>` containing only the
`kody-plugin/` directory. In the PR body list: each tool (name + one-line
description), every `ctx.env` secret the operator must configure in the
Kody admin UI, and which tools are WRITE tools. Once merged and the brand
admin enables the repo under **Admin → Chat → Plugins**, the tools appear
in that client's chat automatically — no platform-side code change.
