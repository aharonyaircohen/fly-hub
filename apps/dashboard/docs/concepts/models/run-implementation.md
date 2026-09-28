# Run implementation

Status: **Current Dashboard projection**

## Storage and UI

- Page: `/agency-runs`
- Storage: Convex `agencyRuns` and Run events
- Writer: backend `createRunRecord` and `finishRunRecord`
- Projection: `packages/agency/src/agency-runs.ts`

The Dashboard maps the stored Run into an operator summary. Fields such as
provider, model, reasoning effort, GitHub URL, and workflow insight currently
remain empty unless another real writer supplies them.

The older published Engine Run contract is richer than the simplified local
contract. The package split must be resolved before those shapes are called one
model.

## Verification

Run a real Capability and Workflow, verify active-to-terminal transitions in
Convex, reload `/agency-runs`, and confirm target, Agent, timestamps, output or
error, parent link, and events match the execution.
