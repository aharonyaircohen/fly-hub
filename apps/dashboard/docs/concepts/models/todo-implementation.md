# Todo implementation

Status: **Current Dashboard verified**

## Dashboard

- Page: `/todos`
- API: `/api/kody/todos`
- Storage: Convex `repoDocs`
- Record key: `todo:<slug>`
- Logical path: `todos/<slug>.json`
- Owner: `packages/workspace/src/todos/files.ts`

Todo lists are saved as JSON documents. The Dashboard does not use GitHub as a
runtime-state fallback.

## Contract warning

The mounted Todo implementation has its own list/item contract. It does not use
the simplified `Todo` validator in `packages/agency-domain`. Consolidating those
contracts is separate architecture work and must preserve the mounted Todo
journey.

## Verification

Create, edit, complete, reload, and delete a Todo from `/todos`, then confirm the
Convex record changes and no GitHub content is written.
