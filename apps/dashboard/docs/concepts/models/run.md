# Run

Status: **Current simplified runtime record**

A Run records one execution of a Loop, Workflow, or Capability.

## Stored contract

```ts
interface Run {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  target: { kind: "workflow" | "capability"; id: string };
  agent: string;
  todoId?: string;
  parentRunId?: string;
  startedAt: string;
  finishedAt?: string;
  output?: unknown;
  error?: string;
}
```

The storage envelope also records the subject type and subject id so the
Dashboard can classify Loop, Workflow, and Capability runs.

## Invariants

1. A Run starts queued or running and finishes once.
2. Identity, target, Agent, parent, Todo link, and start time are immutable.
3. Runtime state belongs in Convex, never GitHub.
4. A Run is history; it does not own reusable definitions.
5. Rich policy snapshots, revision traces, usage, and typed outputs are future
   work unless present in the stored record and real runtime.
