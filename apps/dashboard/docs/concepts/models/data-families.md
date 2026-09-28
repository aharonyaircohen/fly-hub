# Definition, runtime state, and history

Status: **Current architecture rule**

| Family        | Current examples                                | Rule                                 |
| ------------- | ----------------------------------------------- | ------------------------------------ |
| Guidance      | Intent, Context, Policy, Constraint Markdown    | Reasoning input; not execution state |
| Definition    | Agent, Capability, Workflow, Loop               | Reusable configuration               |
| Runtime state | Todo completion, dispatch reservation, approval | Convex-owned mutable state           |
| History       | Run and Run events                              | Convex-owned execution record        |
| Projection    | Dashboard summaries, health, graph              | Rebuildable and non-authoritative    |

One field must have one authority. GitHub may own repository Engine definitions,
but it must not own Dashboard runtime state.

The same package version currently exposes different Agency definitions in the
monorepo and published Engine dependency. This violates the one-contract rule
and blocks a canonical cross-repository model.
