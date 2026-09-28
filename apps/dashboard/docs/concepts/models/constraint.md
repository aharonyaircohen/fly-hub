# Constraint

Status: **Current Markdown guidance**

A Constraint is a plain Markdown hard limit shown in `/constraints`. It is
stored in Convex `repoDocs` as `constraint:<slug>` and may be scoped to Agents.

Constraints explain what Kody must not do and the safe fallback. Security and
data-loss boundaries still require deterministic enforcement in code.

There is no current embedded Agent `constraints` field in the mounted Agent
contract.
