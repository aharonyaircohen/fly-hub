# AI Agency bundle

Status: **Current export/import contract**

The `/company` page exports and imports a portable operating bundle.

## Included

- Agents: slug, title, Markdown body
- Capabilities: complete simple folder
- Context entries and Agent audience
- Repository slash commands
- Instructions
- Portable Engine configuration: quality commands, aliases, and allowed
  associations

## Excluded

- Intent, Todo, Loop, Workflow, and Run
- Memory, secrets, variables, inbox, and notifications
- Runtime state and history
- Repository default branch
- Technical Engine implementation profiles

The exact contract is `CompanyBundle` in
`packages/kody-chat-dashboard/src/dashboard/lib/company/types.ts`.

Import supports `skip` and `overwrite`. Entries are handled independently, so
one failure is reported without discarding successful entries. The config
slice is applied last.

This bundle is not the full Agency runtime and does not prove that an imported
Capability or Agent has been executed.
