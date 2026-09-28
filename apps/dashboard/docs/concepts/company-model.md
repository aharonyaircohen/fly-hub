# AI Agency model

Status: **Current Dashboard model with one P0 Engine integration gap**

This is the simple public model:

```text
Intent     = direction
Todo       = finite operator work
Loop       = repeated activation
Workflow   = capability graph
Capability = reusable method
Agent      = who performs a Workflow
Run        = one execution record
```

Older planning aggregates and a separate public Implementation model are not
part of the current Dashboard architecture.

## System map

```text
Intent                         Todo
   |                             ^
   | guides                      | optional Run link
   v                             |
Loop ----targets----> Workflow ----uses----> Capability
  |                       |
  |                       +----selects----> Agent
  |
  +----targets---------------------------> Capability

Every execution ------------------------------------> Run
```

Intent and Todo do not own the execution graph. A Loop owns activation,
Workflow owns orchestration, Capability owns reusable behavior, Agent owns
identity, and Run owns history.

## Clean architecture

```text
Simple domain contracts
    <- application services
        <- storage and external adapters
            <- Dashboard, Engine, Convex, GitHub, Store
```

Rules:

1. Each model has one responsibility and one owning contract.
2. Runtime state and history are Convex-owned.
3. GitHub may own repository content and Engine definitions, not runtime state.
4. The shared File Manager remains domain-agnostic.
5. Engine implementation profiles are technical assets, not another public
   Agency model.
6. A saved definition is not proof of runtime support.
7. A new model requires a responsibility no existing model can own.

## Current contract split

The monorepo and published Engine both call their package
`@kody-ade/agency-domain@0.5.1`, but expose different contracts.

- The Dashboard monorepo contains the simplified model.
- The Engine's installed package still contains older structured planning
  contracts.
- The Engine scheduler reads older Convex Agency definitions.
- The Dashboard saves simple Loops to repository JSON.

Therefore Engine Loops run, but Dashboard-created simple Loops do not yet enter
that scheduler. Fix this through one explicit migration and new package release,
not fallback or dual-read code.

## Automation rule

Kody automation is composed from existing models:

```text
Loop trigger
  -> Workflow
      -> Capability steps
          -> real Engine/LLM execution
              -> Run
```

Automation does not require another planning aggregate or scheduler model.

## Proof rule

An Agency feature works only after:

1. it is created through the mounted Dashboard;
2. it persists in the intended authority;
3. the real Engine consumes that same stored definition;
4. a real LLM performs the work when required;
5. the Run and result appear in the Dashboard after reload.

See [`models/README.md`](models/README.md) for model-specific contracts and the
current migration gap.
