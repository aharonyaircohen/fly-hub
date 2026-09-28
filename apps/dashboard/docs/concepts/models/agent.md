# Agent

Status: **Current Dashboard contract**

An Agent is a reusable Markdown identity that explains how an AI actor should
work.

## Contract

An Agent has:

- a stable slug;
- a title;
- a Markdown body;
- optional Capability references in frontmatter;
- optional `whenToUse` routing guidance;
- optional Agent references in `subagents`.
- an optional `primaryIntent` relation when the user makes it live.

`subagents` is an assignment, not a separate Agent type. An Agent is the
parent for that relationship when other Agents are assigned to it; each
assigned Agent is its subagent. The same Agent can be used independently or be
assigned to another parent.

An Agent's title and body describe its specialty. There is no separate domain,
specialty, main-agent, or subagent field.

`whenToUse` is not a domain or Agent type. It is plain-language delegation
guidance and becomes required only when the Agent is assigned as a subagent.
The body continues to own how the Agent works.

Agent does not own a Workflow, Todo, or Run. A user-selected live Agent is
scheduled by one Loop targeting that Agent, while dedicated AgentState stores
only its continuation between cycles.

The simplified `AgentDefinition` in `packages/agency-domain` uses
`id`, `name`, `instructions`, and `permissions`, but the mounted Agents page
uses the Markdown bundle above. Neither `role` nor `constraints` is a current
stored Agent field.

## Invariants

1. Agent is identity and relationships; continuation is stored separately as
   AgentState.
2. Permissions must be enforced at dispatch/tool boundaries, not trusted only
   because they appear in prose.
3. A parent may delegate only to Agents explicitly assigned in `subagents`.
4. An assigned subagent receives tools through its Capabilities; assignment
   alone does not grant tools.
5. Built-in Agents are immutable. Store Agents are read-only but may be copied
   into local configuration.
6. Agent does not create a second Implementation model.
7. Kody's effective roster is its locked built-in defaults plus configured
   additions; configured state cannot remove or replace a default.
8. Live is derived from a valid primary Intent relation, AgentState, and an
   Agent-targeting Loop; it is not a separate Agent type or model.
