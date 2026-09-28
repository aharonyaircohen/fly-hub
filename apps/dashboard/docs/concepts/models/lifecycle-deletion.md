# Lifecycle and deletion

Status: **Current model-specific behavior**

There is no shared Agency lifecycle today.

- Intent, Context, Policy, and Constraint are created, edited, or deleted.
- Todo items are open or completed.
- Loop is enabled or disabled.
- Local Agent definitions publish a current bundle and may be retired.
- Workflow and Capability are created, edited, or deleted.
- Run moves from queued/running to succeeded, failed, or cancelled and is
  retained as history.

Do not invent draft/active/paused/retired/archived fields for every model.
Before deletion, check mounted dependencies and retained Run history. Runtime
history must not be deleted as a side effect of deleting a definition.
