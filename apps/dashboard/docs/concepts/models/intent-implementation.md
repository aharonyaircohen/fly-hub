# Intent implementation

Status: **Current Dashboard verified; Engine contract split remains**

## Dashboard

- Page: `/agency`
- API: `/api/kody/intents`
- UI: `IntentFilesView` through the shared guidance file workspace
- Storage: Convex `repoDocs`
- Record key: `intent:<slug>`
- Stored content: Markdown body with generic guidance frontmatter

`loadGuidanceForPrompt("intent", agentSlug)` combines applicable Intents for a
prompt. Intents are not converted into execution definitions.

## Known debt

`packages/workspace/src/guidance/files.ts` still reads the old
`agency:intent` record when `intent:agency` is absent. This compatibility reader
conflicts with the clean-migration rule and should be removed after stored data
is explicitly migrated or deleted.

The published Engine `@kody-ade/agency-domain@0.5.1` still contains a structured
Intent model. That is not the Dashboard Intent contract.

## Verification

Required proof:

1. Create an Intent in `/agency`.
2. Reload and verify persistence.
3. Run a real chat/Engine request whose prompt loads the Intent.
4. Verify unrelated Intents are not treated as executable work.
