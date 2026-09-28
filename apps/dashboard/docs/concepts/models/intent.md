# Intent

Status: **Current Dashboard contract**

An Intent is a plain Markdown direction that tells Kody what outcome or
direction to pursue.

## Contract

An Intent has:

- a stable filename/slug;
- a Markdown body;
- no status, priority, owner, Workflow, or execution fields.

Every Intent applies by default. An Intent does not execute work directly.

## Responsibility

Use Intent for durable direction. Use:

- Todo for finite work;
- Loop for repeated activation;
- Workflow for orchestration;
- Capability for reusable behavior;
- Policy or Constraint guidance for decision rules and hard limits.

## Invariants

1. One Intent expresses one direction.
2. Intent is guidance, not runtime state.
3. Intent does not own other Agency models.
4. Deleting an Intent does not delete work or execution history.
5. The filename is identity; the body remains plain Markdown.

Structured Intent definitions from the older Agency package are not part of the
current Dashboard contract.
