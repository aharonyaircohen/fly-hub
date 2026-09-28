# Kody Agency model index

Status: **Verified current-state map, not a promise that every surface is integrated**

This directory describes what Kody stores and runs today. Proposed designs are
labelled as future work and must not be presented as current behavior.

## Current operator model

| Model      | Purpose                                              | Dashboard authority                                         | Engine status                                          |
| ---------- | ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| Intent     | Plain-language direction                             | Convex `repoDocs`, `intent:<slug>`                          | Loaded as guidance; not a structured Agency definition |
| Todo       | Finite operator work list                            | Convex `repoDocs`, `todo:<slug>`                            | Operator-owned work list                               |
| Loop       | Repeated trigger targeting a Workflow or Capability  | GitHub `.kody-engine/definitions/loops/<id>/loop.json`      | **Not yet consumed by the published scheduler**        |
| Workflow   | Agent-owned graph of Capability calls                | Convex workflow store                                       | Runnable through the Dashboard dispatch path           |
| Capability | Reusable instructions with optional skills and tools | Convex `repoDocs` folder map; Store assets may be read-only | Loaded by the generic Capability runner                |
| Agent      | Reusable Markdown identity                           | Convex definition bundle; Store assets may be read-only     | Selected by Workflow                                   |
| Run        | Execution record                                     | Convex runtime tables                                       | Written by dispatch/runtime paths                      |

Older planning aggregates and a separate public Implementation model are not
part of the current Dashboard model.

## P0 contract split

The monorepo source for `@kody-ade/agency-domain` has been simplified, but it
still reports version `0.5.1`. The published `0.5.1` package used by
`kody-engine` contains older structured Agency contracts.

Consequences:

- the Dashboard and Engine currently compile against different contracts with
  the same package version;
- scheduled Engine Loops run, but they read the older Convex Agency definition
  and state records;
- the simple Loop files created by the Dashboard are not read by that scheduler;
- no documentation may call the simplified model fully integrated until this
  package and persistence boundary is reconciled and live-tested.

This is an integration gap, not a reason to restore retired planning models.

## Source precedence

When sources disagree, use the source that owns the question:

| Question                    | Authority                                                       |
| --------------------------- | --------------------------------------------------------------- |
| What the Dashboard accepts  | Mounted route plus its validator/type                           |
| What the Dashboard persists | Current writer plus a checked stored record                     |
| What the Engine accepts     | The exact installed package and Engine loader                   |
| What executes               | Current Engine dispatch path plus a real model-backed run       |
| What the user sees          | Mounted Dashboard route plus browser verification               |
| What should exist           | A reviewed model decision, clearly separated from current state |

Never infer runtime support from a save form, type union, or old implementation
guide.

## Current documents

Read these before changing an active model:

| Model      | Contract                         | Current implementation                                         |
| ---------- | -------------------------------- | -------------------------------------------------------------- |
| Intent     | [`intent.md`](intent.md)         | [`intent-implementation.md`](intent-implementation.md)         |
| Todo       | [`todo.md`](todo.md)             | [`todo-implementation.md`](todo-implementation.md)             |
| Loop       | [`loop.md`](loop.md)             | [`loop-implementation.md`](loop-implementation.md)             |
| Workflow   | [`workflow.md`](workflow.md)     | [`workflow-implementation.md`](workflow-implementation.md)     |
| Capability | [`capability.md`](capability.md) | [`capability-implementation.md`](capability-implementation.md) |
| Agent      | [`agent.md`](agent.md)           | [`agent-implementation.md`](agent-implementation.md)           |
| Run        | [`run.md`](run.md)               | [`run-implementation.md`](run-implementation.md)               |

Cross-model truth:

- [`relationships.md`](relationships.md)
- [`data-families.md`](data-families.md)
- [`storage-authority.md`](storage-authority.md)
- [`dispatch-approval.md`](dispatch-approval.md)
- [`migration.md`](migration.md)

## Design notes

The remaining documents describe reusable values or possible future work. Each
must say whether it is implemented. A design note cannot add a public model or
authorize code by itself.

Examples include Objective, Scope, revision envelopes, typed Run outputs,
generalized policy resolution, and richer tracing.

## Completion rule

A model is integrated only when all of these agree:

1. Dashboard contract and storage.
2. Published Engine dependency and loader.
3. Dispatch and runtime state.
4. Dashboard user journey.
5. A real LLM-backed live test where the feature uses an LLM.

Static tests alone cannot prove a cross-repository Agency feature works.
