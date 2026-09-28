import { describe, expect, it } from "vitest";

import { listBuiltinAgentFiles } from "@kody-ade/agency/builtin-agents";
import { inferPublicAgentRouteFromDefinitions } from "../../app/api/kody/chat/kody/public-agent-routing";

const specialists = listBuiltinAgentFiles().filter(
  ({ slug }) => slug !== "kody",
);

describe("built-in specialist routing", () => {
  it.each([
    ["Explain AI Agency structure.", "agency-specialist"],
    ["Explain this repository's structure.", "repository-analyst"],
    ["Do you know how to add a new todo?", "agency-specialist"],
    ["r u able to run merge wf?", "agency-specialist"],
    ["Check CI status and blockers.", "operations-specialist"],
    ["Which models and secrets are configured?", "system-admin"],
    ["What chat models are currently configured?", "system-admin"],
    ["What policies and memory constrain this request?", "context-scout"],
    ["Explain how this dashboard preview works.", "ui-vibe-specialist"],
  ])("routes %s to %s from Agent definitions", (prompt, expectedAgent) => {
    expect(inferPublicAgentRouteFromDefinitions(prompt, specialists)).toEqual({
      mode: "delegate",
      assignments: [{ agent: expectedAgent, task: prompt }],
    });
  });
});
