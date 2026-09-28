# Workflow implementation

Status: **Current Dashboard path; cross-repository contract needs consolidation**

## Dashboard

- Page: `/workflows`
- API: `/api/kody/company/workflows`
- Mounted contract:
  `packages/kody-chat-dashboard/src/dashboard/lib/workflow-definitions.ts`
- Local storage: Convex workflow store
- Store workflows: read-only GitHub assets

The Dashboard validates duplicate steps, missing targets, ambiguous branches,
missing defaults, bad data paths, unreachable steps, missing terminal steps,
and unbounded cycles before saving.

## Runtime boundary

The Workflow run route dispatches the selected Workflow. Engine behavior must be
checked against the installed Engine version; the similarly named
`WorkflowDefinition` in `packages/agency-domain` has a different shape and must
not be substituted.

## Verification

Required proof:

1. Build and save a branched Workflow in `/workflows`.
2. Reload it from Convex.
3. Run it through the real Engine.
4. Exercise both a conditional and default branch with real Capability/LLM
   output.
5. Verify bounded repetition stops at its configured limit.
6. Verify the Run and final result appear in the Dashboard.
