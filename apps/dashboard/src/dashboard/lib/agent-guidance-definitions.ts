import type { GuidanceDefinition } from "./components/AgentGuidanceFilesView";

export const CONTEXT_DEFINITION: GuidanceDefinition = {
  kind: "context",
  title: "Context",
  routeBase: "/context",
  singular: "Entry",
  purpose:
    "Write durable facts the assigned agents should know about the product, users, vocabulary, and architecture.",
  examples: [
    "State facts that can be checked and updated when reality changes.",
    "Keep behavior rules in Policies and hard limits in Constraints.",
    "Split unrelated subjects so each entry has clear ownership.",
  ],
};

export const INTENTS_DEFINITION: GuidanceDefinition = {
  kind: "intents",
  title: "Intents",
  routeBase: "/agency",
  singular: "Intent",
  purpose:
    "Write the outcomes and directions this Agency should pursue. Every intent applies by default.",
  examples: [
    "Keep each intent focused on one direction or desired outcome.",
    "Use the filename as its short identity.",
    "Do not add priority, status, ownership, or workflow fields.",
  ],
  agentScoped: false,
};

export const CONSTRAINTS_DEFINITION: GuidanceDefinition = {
  kind: "constraints",
  title: "Constraints",
  routeBase: "/constraints",
  singular: "Constraint",
  purpose:
    "Write hard limits the assigned agents must never cross. Keep each file narrow, testable, and free of preferences.",
  examples: [
    "State the forbidden action or required boundary directly.",
    "Explain the safe fallback when the limit blocks a request.",
    "Avoid vague words such as usually, ideally, or when possible.",
  ],
};

export const POLICIES_DEFINITION: GuidanceDefinition = {
  kind: "policies",
  title: "Policies",
  routeBase: "/policies",
  singular: "Policy",
  purpose:
    "Write repeatable decision rules for choosing among allowed actions. Policies guide judgment but do not replace hard constraints.",
  examples: [
    "Use a clear if/then rule and name the decision it controls.",
    "Include exceptions and who can approve them.",
    "Keep facts in Context and non-negotiable limits in Constraints.",
  ],
};
