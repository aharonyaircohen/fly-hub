# Workflow

Status: **Current Dashboard contract**

A Workflow is a graph of Capability calls run by one Agent.

## Contract

```ts
interface WorkflowDefinition {
  name: string;
  agent: string;
  capabilities: string[];
  startAt?: string;
  steps?: Array<{
    id: string;
    capability: string;
    input?: unknown;
    next?: Array<{
      to: string;
      when?: Record<string, unknown>;
      default?: boolean;
      maxIterations?: number;
    }>;
  }>;
  runWithoutApproval?: boolean;
  createdAt: string;
  updatedAt: string;
}
```

## Responsibility

- Workflow owns step order, branching, bounded cycles, and input.
- Workflow selects one Agent for the run.
- Capability owns instructions, skills, and tools.
- Loop owns repeated activation.
- Run owns execution state and output.

## Invariants

1. Every step references one declared Capability.
2. `startAt` references an existing step.
3. Conditional branches have one default path.
4. Backward edges have a finite `maxIterations`.
5. Every saved step is reachable and at least one terminal step is reachable.
6. Capability input is one JSON-compatible value.
7. Workflow does not own another planning aggregate or a separate Implementation.

The separate `WorkflowDefinition` in the simplified agency-domain package is
not the mounted Dashboard workflow contract.
