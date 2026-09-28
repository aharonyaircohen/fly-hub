# Todo

Status: **Current Dashboard contract**

A Todo is a finite operator-managed list of work.

## Contract

Each Todo list has a slug, title, description, timestamps, and items. Each item
has an id, title, optional body and assignee, completion state, and timestamps.

## Invariants

1. Todo represents finite work, not repeated automation.
2. Todo completion is explicit operator/runtime state.
3. Todo does not replace Workflow execution history.
4. Todo does not imply an Engine execution definition.
5. Todo storage is repository-scoped runtime state in Convex.

The small `Todo` interface currently present in `packages/agency-domain` is not
the mounted Todo page's persisted contract. This duplicate contract must not be
treated as canonical.
