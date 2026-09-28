<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Entity registry rule (load-bearing)

All data entities are defined ONCE in `src/entities.ts` (table + state
paths + file mapper). The import allowlist, export walker, and GitHub
mapping derive from it. To add a new entity: add the table to
`convex/schema.ts` AND a registry entry — the drift test
(`tests/unit/entity-registry.spec.ts`) fails if either side is missing.
Never hand-extend table lists or path lists anywhere else.
