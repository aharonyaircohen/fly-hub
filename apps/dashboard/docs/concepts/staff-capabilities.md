# Agents and Capabilities

Status: **Current Dashboard model**

Agent and Capability are separate:

- Agent is reusable identity and guidance.
- Capability is reusable behavior.
- Workflow selects one Agent and connects Capability steps.
- Loop decides when a Workflow or Capability becomes eligible.

An Agent is stored as `agent.md` in a versioned Convex definition bundle. A
Capability is a simple folder containing `instructions.md`, `contract.json`,
`skills/`, and `tools/`.

A Capability does not own Agent selection, cadence, approval, Workflow, model,
or provider. Technical Engine `profile.json` files remain runtime assets and
are not edited as another Agency model.

## Runtime map

These are separate objects with separate responsibilities:

```text
Guide -> Workflow -> Capability -> Engine run -> Run result
          |             |
          `-- Agent     `-- instructions.md / contract.json / skills / tools
```

- The Dashboard saves local definitions in the Kody backend, scoped to the
  connected `owner/repository`.
- The Engine fetches those definitions at run start and hydrates a disposable
  `.kody-engine/definitions/` directory in the consumer checkout.
- The consumer repository normally contains only the launcher workflow and
  repository configuration; it is not the source of local capability content.
- Company Store capabilities are read-only shared assets. They are a separate
  source and must be active before a workflow can use them.

## Compatibility boundary

The Engine still reads older capability folders such as `capability.md` plus
`definition.json` (and older implementation profiles) for migration support.
Those are runtime compatibility formats, not a second Dashboard model. New
Dashboard capabilities must use `instructions.md` and `contract.json`.

See [`models/agent.md`](models/agent.md) and
[`models/capability.md`](models/capability.md).
