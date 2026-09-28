# Relationship and ownership map

Status: **Current Dashboard map**

| From          | To                     | Relationship                  | Declared by       |
| ------------- | ---------------------- | ----------------------------- | ----------------- |
| Workflow      | Agent                  | dependency                    | `workflow.agent`  |
| Workflow step | Capability             | dependency                    | `step.capability` |
| Loop          | Workflow, Capability, Pipeline, or Agent | dependency | `loop.target` |
| Agent         | Intent                 | optional primary direction    | `agent.primaryIntent` |
| Agent         | Capability             | optional guidance dependency  | Agent frontmatter |
| Run           | Workflow, Capability, Pipeline, or Agent | historical target | `run.target` |
| Run           | Todo                   | optional association          | `run.todoId`      |
| Run           | Run                    | optional parent/child history | `run.parentRunId` |

Intent and Todo do not own other Agency models. AgentState is continuation owned by
one Agent; it does not own scheduling or history. Older planning aggregates are not part
of this map. Runtime state does not establish definition ownership.

The current product has duplicate TypeScript contracts for Todo, Workflow, and
Agent. Relationships must be checked at the mounted writer/validator until
those contracts are consolidated.
