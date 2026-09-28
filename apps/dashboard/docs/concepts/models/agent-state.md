# AgentState

Status: **Current Dashboard and Engine contract**

AgentState is the private continuation a live Agent carries from one cycle to
the next.

```ts
interface AgentState {
  version: 1;
  agent: string;
  revision: number;
  cursor: string;
  summary: string;
  data: Record<string, unknown>;
  updatedAt: string;
}
```

AgentState does not contain Intent, Policies, Context, Capabilities, schedule,
health, or run history. Those remain owned by their existing resources, Loop,
and Run. Writes use the previous revision to prevent overlapping Agent cycles
from silently replacing one another.
