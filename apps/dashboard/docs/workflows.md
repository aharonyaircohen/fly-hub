# Workflows

Status: **Current Dashboard contract**

A Workflow is an Agent-owned graph of Capability calls. It owns steps, input,
connections, conditions, default branches, bounded cycles, and whether direct
execution may skip approval.

Local Workflows are stored in Convex. Store Workflows are read-only assets.
The `/workflows` page creates, edits, validates, runs, and deletes local
definitions.

Workflow does not own a schedule, Capability instructions, runtime state,
another planning aggregate or technical Engine implementation profile.

See [`concepts/models/workflow.md`](concepts/models/workflow.md) for the exact
contract and
[`concepts/models/workflow-implementation.md`](concepts/models/workflow-implementation.md)
for verification requirements.
