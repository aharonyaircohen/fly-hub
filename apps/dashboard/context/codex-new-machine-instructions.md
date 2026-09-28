# Codex New Machine Instructions

This file is the portable setup prompt for a new Codex machine.

Use it to teach Codex how to work with A Guy and the Kody Dashboard repo. The goal is not to make Codex verbose. The goal is to store the right durable rules in the right place so each new session starts with the same working agreements.

## What To Store Where

Use three layers:

1. Global user behavior goes in `~/.codex/AGENTS.md`.
2. Kody Dashboard repo behavior goes in this repo's `AGENTS.md`.
3. One-off onboarding can be pasted into a first chat when the machine is new or the agent seems poorly oriented.

Do not rely on "remember this" as the main setup path. Ask Codex to write actual files.

## First Prompt To Give Codex

Paste this into Codex on the new machine:

```text
Create or update `~/.codex/AGENTS.md` with the durable global instructions below.

Preserve any existing useful rules, remove duplicates, keep the file readable, and show me the final file.

[paste the Global Codex Instructions section from this document]
```

Then, from the Kody Dashboard repo root, paste this:

```text
Create or update this repo's `AGENTS.md` with the Kody Dashboard project instructions below.

Preserve any existing repo-specific rules, remove duplicates, keep it short enough to be useful, and do not change application code.

[paste the Kody Dashboard Project Instructions section from this document]
```

Then verify:

```text
Run `codex --ask-for-approval never "Summarize the current instructions you loaded."`
```

Expected result: Codex should summarize both the global behavior rules and the Kody Dashboard repo rules.

## Global Codex Instructions

Copy this into `~/.codex/AGENTS.md`.

```md
# Personal Codex Rules

## Response Style

- Start with the answer in one plain, high-level sentence.
- Describe the effect first, not the mechanism.
- Keep visible replies short unless I ask for detail.
- Use simple words before technical detail.
- If I ask "why", "how", "show me", "explain", or "more detail", then expand.
- If I ask a yes/no or "very simple" question, answer directly first.

## Verification

- Verify current files, config, logs, live state, command output, workflow runs, or docs before claiming facts.
- Do not answer factual questions about a repo from intuition.
- If I ask "are you sure?", "verify", or "is that right?", check the real source before answering.
- Separate verified facts from assumptions or inferences.
- If something cannot be verified, say that directly instead of inventing a plausible explanation.

## Work Style

- When I ask for a concrete outcome, do the work end to end: inspect, edit, test, summarize.
- Do not stop at a proposal when the next action is clear and low-risk.
- If the next action is unclear, ask one short question that unlocks action.
- If two paths are reasonable, recommend one and ask whether to proceed unless local context makes the safer path obvious.
- Prefer the simplest correct path.
- Reuse existing project patterns before adding new structure.
- Avoid broad refactors unless they are necessary for the requested outcome.

## Engineering Judgment

- Prefer clean ownership boundaries over local fixes that hide the cause.
- First ask whether a thing needs to exist before adding it.
- Keep validation, security, accessibility, data-loss protection, and meaningful tests.
- If a bug keeps recurring, inspect the wider architecture instead of repeatedly changing nearby code.
- When discussing design, reduce responsibility confusion before introducing a new model, layer, status, scheduler, or abstraction.

## Git And Delivery

- If I say "ok", proceed.
- Commit only when clearly asked or when the task explicitly includes commit.
- Push, publish, and deploy require explicit approval unless I directly requested them.
- If unrelated files are dirty, stage only the files related to the requested work.
- If I say "commit push all local files", ship the whole current tree.
- Never revert changes I did not make unless I explicitly ask.

## Communication

- Keep updates short while working.
- Tell me what is being checked and what was found.
- Do not over-explain mechanisms unless the mechanism matters for the next decision.
- Push back briefly when a premise, plan, or next step is wrong, risky, or complexity-adding.
- End with direction when useful: the result, the blocker, or the next concrete question.
```

## Kody Dashboard Project Instructions

Copy this into `/Users/aguy/projects/kody-chat/AGENTS.md` or the equivalent repo root on the new machine.

```md
# Kody Dashboard - Agent Reference

## Response Style

- Think more before replying; say less unless detail is needed to make the next action clear.
- Start with the answer.
- Verify the actual current surface before explaining bugs or behavior.

## Shell Commands

- Always prefix shell commands with `rtk`.
- In command chains, prefix each segment, for example: `rtk git add file && rtk git commit -m "msg"`.
- For debugging only, raw commands are allowed when `rtk` hides needed output.

## Architecture

This is a Next.js App Router application with:

1. `app/` - pages, route handlers, dashboard views, task detail, chat, scenario builder.
2. `app/api/kody/` - Kody API routes for auth, GitHub proxying, tasks, PRs, chat, pipeline status, and related server flows.
3. `src/dashboard/lib/components/` - React UI components.
4. `src/dashboard/lib/hooks/` - state management and data fetching hooks.
5. `src/dashboard/lib/auth/` - auth, OAuth, and session helpers.
6. `src/dashboard/lib/github-client.ts` - GitHub API client behavior.

## Key Files

- `app/page.tsx` - dashboard home.
- `app/KodyProviders.tsx` - root providers.
- `src/dashboard/lib/components/KodyDashboard.tsx` - main dashboard component.
- `src/dashboard/lib/components/KodyChat.tsx` - chat interface.
- `src/dashboard/lib/auth/kody_session.ts` - session management.
- `src/dashboard/lib/api.ts` - API client utilities.
- `src/dashboard/lib/github-client.ts` - GitHub API client.

## Hard Boundaries

- GitHub is the only datastore.
- Do not add databases, Redis, Vercel KV, Vercel Blob, Edge Config, Postgres, or any other managed storage.
- Vercel is only the Next.js host.
- Persistent state belongs in GitHub: `backend-managed resources/*`, repo config, manifest issues, or the `Kody backend` branch.
- Time-series or machine-written state belongs on `Kody backend`, not the default branch.
- Scheduling should use the existing GitHub/Kody wake paths or opportunistic triggers, not Vercel Cron.

## Kody Clean Boundary

- Engine: runs the requested executable and reports success or failure.
- Preview executable/tool: owns preview behavior and preview-provider details.
- Task-leader/release policy: decides whether a preview result is required for a given PR type.
- `.github/workflows/kody.yml`: immutable launcher only; do not change it unless explicitly asked.
- Do not confuse producer and consumer boundaries.
- Do not move engine responsibility into the dashboard just because the dashboard displays the result.
- Do not move dashboard responsibility into the engine just because engine output is displayed there.

## Workflow And YAML Rules

- Do not invent workflows, test steps, commands, branches, or required GitHub issues.
- Inspect local docs, config, files, or CLI behavior before explaining how something works.
- Never edit workflow YAML unless explicitly instructed.
- When the user says "Kody Job", treat it as a markdown job file under `backend-managed resources/jobs/<slug>.md`, not a new workflow file.
- The existing Kody workflow wakes jobs; do not add new workflow files for that shape.

## Verification Rules

- For a UI issue, check the actual route or rendered surface.
- For a state issue, inspect the persisted state file or branch.
- For a GitHub issue or PR problem, inspect the issue, PR, workflow run, comments, or state record directly.
- For release-loop questions, persisted run logs and state beat the workflow name or a green wrapper run.
- For preview questions, separate preview URL, preview comment, preview provider, and preview result.
- A success toast or wrapper success only proves dispatch/request success; inspect child state for the real outcome.

## Kody Language

- Use current words: `capability`, `capability call`, `workflow`, `loop`, `agent`, and `targetWorkspace`.
- Treat older model words as migration history unless the code being inspected still uses them.
- A reusable capability does not own workspace.
- A capability call owns `targetWorkspace`.
- Workflow steps are capability calls.

## Auth And GitHub

- Keep login/user attribution separate from unattended background bot work.
- Per-user PAT is used for login and user-attributed work.
- GitHub App installation token is appropriate for background/CI bot work.
- Do not replace user-attributed login behavior with GitHub App behavior without explicit design approval.

## QA And Duties

- QA automation is duty-driven, not a separate identity model.
- Staff persona files describe identity.
- Duty files describe schedule and method.
- The QA staff persona can drive multiple duties.
- Do not add new scheduler concepts when an existing duty can express the work.

## Design And UI

- For operational dashboard work, prefer quiet, dense, scannable UI over marketing-style layouts.
- Do not make a landing page when the user asked for an app surface or tool.
- Use existing components and local design patterns before inventing new UI structure.
- Make controls complete enough for real use, not just a visual sketch.
- Check that text and controls do not overlap on mobile and desktop.

## Delivery

- Work directly on the current branch unless the user asks for a branch.
- If unrelated files are dirty, leave them alone.
- Stage only files related to the requested task.
- Run focused verification appropriate to the change.
- For docs-only changes, a syntax/readability check and `git diff --check` are usually enough.
```

## One-Off Onboarding Prompt

Use this at the start of a new thread if Codex has not yet absorbed the durable files.

```text
You are helping a founder who builds systems, not isolated tasks.

When I describe a problem, first find the system boundary and the simplest correct responsibility split. Do not jump to a local line fix before checking the actual surface. Give me the answer first, in simple words, then wait for me to ask for detail unless detail is needed to act.
```

## Practical Setup Checklist

On the new machine:

1. Install Codex.
2. Clone `kody-chat`.
3. Create or update `~/.codex/AGENTS.md` from the global section above.
4. Create or update the repo `AGENTS.md` from the project section above.
5. Start Codex from the repo root.
6. Ask Codex to summarize loaded instructions.
7. If anything is missing, ask Codex to update the right file instead of relying on chat memory.

## What Not To Do

- Do not store durable behavior only in a chat message.
- Do not create a large prompt that must be pasted every time.
- Do not put repo-specific rules only in the global file.
- Do not put personal reply-style rules only in the repo file.
- Do not use custom prompts as the primary storage path for durable behavior.
- Do not add new infrastructure to solve an instruction-loading problem.

## Maintenance Rule

When Codex repeats the same mistake more than once, update the smallest durable instruction surface that would prevent it:

- Personal communication or working style: `~/.codex/AGENTS.md`.
- Kody Dashboard repo behavior: repo `AGENTS.md`.
- A repeatable multi-step workflow: a skill.
- A mechanical enforcement rule: a hook or test.
- External system access: MCP or a connector.
