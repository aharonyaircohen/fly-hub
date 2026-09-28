# Policy

Status: **Current Markdown guidance**

A Policy is a plain Markdown decision rule shown in `/policies`. It is stored in
Convex `repoDocs` as `policy:<slug>` and may be scoped to Agents.

Policy guides judgment. It does not by itself enforce permissions, approval,
budgets, or capacity. Deterministic safety rules must also exist at the actual
dispatch, API, or tool boundary.

The older Engine's structured policy snapshot is a different contract and must
not be presented as the Dashboard Policy model.
