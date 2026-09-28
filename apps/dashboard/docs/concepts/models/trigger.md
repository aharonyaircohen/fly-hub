# Trigger

Status: **Current event-to-action rule**

A Trigger listens for one catalog event, checks optional conditions, and runs
one explicit action. It is separate from a Loop: GitHub events start a
Workflow directly and do not create a Loop.

```ts
interface TriggerConfig {
  id: string;
  event: string;
  conditions: TriggerCondition[];
  action:
    | { type: "save-user-state"; namespace: string; map: Record<string, string> }
    | { type: "start-workflow"; workflowId: string; inputMap: Record<string, string> };
}
```

The first GitHub event is `github.workflow_run.completed`. A condition such as
`conclusion equals failure` can start a CI-repair Workflow. The webhook keeps
its existing URL and cache/notification behavior; the event-to-Workflow action
uses durable Convex delivery claims keyed by GitHub delivery plus trigger.

Loop activation remains a separate contract:

```ts
type LoopTrigger =
  | { type: "manual" }
  | { type: "schedule"; every: string; at?: { time: string; timezone: string } }
  | { type: "event"; event: string }
  | { type: "webhook"; event: string }
  | { type: "condition"; expression: string };
```

Legacy Loop files can contain all five values, but new Loop UI only offers
manual and schedule. The published Engine's older Loop system executes manual
and schedule only; new event-driven behavior uses the Trigger action above.

Trigger configuration is user-owned and audited. Workflow validation,
approval/trust, dispatch, and run history remain owned by the existing Workflow
execution boundary.
