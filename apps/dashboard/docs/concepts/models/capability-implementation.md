# Capability implementation

Status: **Current Dashboard and generic Engine loader**

## Dashboard

- Page: `/capabilities`
- Local storage: Convex `repoDocs`, `capability:<slug>`
- Store capabilities: read-only GitHub assets
- Owner: `packages/agency/src/capabilities/files.ts`

The file contract permits only `instructions.md`, `contract.json`, `skills/**`,
and `tools/**`. `contract.json` selects `execution: "agent" | "script"` and
script-backed Capabilities may declare an exact `secrets` allowlist;
script-backed Capabilities use the fixed `tools/run.sh` entrypoint.
The shared File Manager edits the folder through Capability-owned configuration;
the File Manager remains domain-agnostic.

## Engine

`loadSimpleCapability` reads the folder and input. Agent execution builds one
prompt from instructions, skills, and tool paths. Script execution runs
`tools/run.sh`; both paths return the same validated JSON output.

Engine `profile.json` files select technical provider/model/scripts and runtime
behavior. They are not user-managed Implementation definitions.

## Verification

Create the folder in `/capabilities`, reload it, run it directly with a real
LLM, verify one JSON output, and confirm the Engine used the requested
Capability without capability-specific branching in the generic executor.
