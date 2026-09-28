# Dispatch and approval

Status: **Partly implemented; simple Loop integration missing**

Dispatch must authenticate the tenant, resolve the target, enforce permission
and approval, reserve idempotently, create a Run, invoke the Engine, and finish
the Run exactly once.

The published Engine's older Loop path implements schedule/manual decisions,
idempotency, approval, capacity, retries, and Run recording. The current
Dashboard simple Loop definitions do not enter that path.

Workflow and Capability dispatch must be verified separately against their
mounted routes. A saved definition or union member is not runtime proof.

No new automation is complete until the same definition created in the
Dashboard reaches the real Engine and its Run is visible after reload.
