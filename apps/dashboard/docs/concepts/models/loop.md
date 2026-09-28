# Loop

Status: **Current Dashboard contract; event bindings moved to Triggers**

A Loop keeps work moving until its responsibility is satisfied.

Kody has exactly two product-level Loop types:

1. A **Constructor Loop** is temporary. It builds and verifies one Agency
   request, uses that request's Todo as durable state, retries failed Workflow
   attempts, and disappears after publishing the completion Report.
2. A **Maintainer Loop** is durable. It belongs to an installed Solution and
   continues monitoring or repairing that Solution after construction has
   succeeded.

Workflow step retries are ordinary Workflow control flow. They are not a third
Loop type.

## Dashboard contract

```ts
interface LoopDefinition {
  id: string;
  trigger:
    | { type: "manual" }
    | {
        type: "schedule";
        every: string;
        at?: { time: string; timezone: string };
      };
  /* event/webhook/condition remain readable for legacy definitions only */
  target: { kind: "workflow" | "capability"; id: string };
  input: Record<string, unknown>;
  enabled: boolean;
}
```

## Responsibility

- Constructor Loop owns completion of one Agency request.
- Maintainer Loop owns ongoing Solution activation.
- Workflow owns orchestration.
- Capability owns reusable behavior.
- Run owns execution history.
- Todo owns Constructor progress, evidence, and recovery state.
- Loop does not contain another planning aggregate.

## Current support

| Trigger   | Dashboard accepts | Published Engine executes this simple Loop |
| --------- | ----------------- | ------------------------------------------ |
| Manual    | Yes               | Yes                                        |
| Schedule  | Yes               | Yes                                        |
| Event     | Legacy read only  | No                                         |
| Webhook   | Legacy read only  | No                                         |
| Condition | Legacy read only  | No                                         |

New event-driven behavior belongs to the Trigger model. A matching Trigger
starts its Workflow directly, so an event does not create one Loop per
delivery. Existing Loop files with event, webhook, or condition values are
still parsed and displayed as legacy values while they are migrated.

## Invariants

1. One Loop has one target.
2. A disabled Loop never fires.
3. Each firing needs an idempotency key.
4. Runtime state and Runs never live inside the Loop definition.
5. Saving a trigger is not proof that the Engine supports it.
6. A Constructor Loop exists only while its Todo remains active.
7. A successful Constructor removes itself after verified delivery. The
   Maintainer becomes the ongoing owner when that delivery is accepted.
8. A technical Workflow failure keeps the Constructor active; only a real user
   decision moves the Todo to waiting-for-information.

See [Blueprint construction](../blueprint-construction.md) for the full
ownership and installation lifecycle.
