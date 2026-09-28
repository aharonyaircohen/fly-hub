import { describe, expect, it } from "vitest";

import {
  BUILTIN_SPECIALIST_SLUGS,
  listBuiltinAgentFiles,
  readBuiltinAgentCapability,
} from "../src/builtin-agents";

describe("built-in Kody specialists", () => {
  it("ships Kody with the seven focused specialists assigned", () => {
    const agents = listBuiltinAgentFiles();
    const kody = agents.find((agent) => agent.slug === "kody");

    expect(agents).toHaveLength(8);
    expect(new Set(agents.map((agent) => agent.slug)).size).toBe(8);
    expect(kody?.subagents).toEqual(BUILTIN_SPECIALIST_SLUGS);
    expect(kody?.lockedSubagents).toEqual(BUILTIN_SPECIALIST_SLUGS);
    expect(agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "context-scout" }),
        expect.objectContaining({ slug: "repository-analyst" }),
        expect.objectContaining({ slug: "operations-specialist" }),
        expect.objectContaining({ slug: "agency-specialist" }),
        expect.objectContaining({ slug: "system-admin" }),
        expect.objectContaining({ slug: "ui-vibe-specialist" }),
        expect.objectContaining({ slug: "cto", title: "CTO" }),
      ]),
    );
  });

  it("gives the built-in CTO read-only evidence tools and project-health ownership", () => {
    const cto = listBuiltinAgentFiles().find(({ slug }) => slug === "cto");
    const capability = readBuiltinAgentCapability(cto!.capabilities![0]!);
    const tools = capability!.capabilityTools.map(({ name }) => name);

    expect(cto).toMatchObject({
      title: "CTO",
      source: "builtin",
      readOnly: true,
      whenToUse: expect.stringContaining("project health"),
    });
    expect(cto?.capabilities).toEqual(["builtin-agent-cto"]);
    expect(capability?.instructions).toContain("maintainability");
    expect(cto?.body).toContain("technical health and long-term maintainability");
    expect(cto?.body).toContain("verified facts");
    expect(tools).toEqual(
      expect.arrayContaining([
        "github_blame",
        "github_commits_for_path",
        "github_get_pull_request",
        "github_list_issues",
      ]),
    );
    expect(tools).not.toEqual(
      expect.arrayContaining([
        "github_comment_on_issue",
        "create_feature",
        "request_release",
      ]),
    );
  });

  it("keeps every built-in read-only and gives each specialist scoped actions", () => {
    const agents = listBuiltinAgentFiles();

    for (const agent of agents) {
      expect(agent.source).toBe("builtin");
      expect(agent.readOnly).toBe(true);
    }

    for (const specialist of agents.filter(
      ({ slug }) => slug !== "kody" && slug !== "cto",
    )) {
      expect(specialist.whenToUse).toBeTruthy();
      expect(specialist.capabilities).toHaveLength(1);
      const capability = readBuiltinAgentCapability(
        specialist.capabilities![0]!,
      );
      expect(capability?.instructions).toContain(specialist.title);
      expect(capability?.capabilityTools.length).toBeGreaterThan(0);
    }
  });

  it("does not give presentation renderers to a specialist", () => {
    const specialistTools = listBuiltinAgentFiles()
      .filter(({ slug }) => slug !== "kody")
      .flatMap(({ capabilities }) =>
        capabilities!.flatMap(
          (slug) =>
            readBuiltinAgentCapability(slug)?.capabilityTools.map(
              ({ name }) => name,
            ) ?? [],
        ),
      );

    expect(specialistTools).not.toContain("final_answer");
    expect(specialistTools).not.toContain("show_view");
  });

  it("gives the single Agency Specialist workflow governance and execution tools", () => {
    const specialist = listBuiltinAgentFiles().find(
      ({ slug }) => slug === "agency-specialist",
    );
    const capability = readBuiltinAgentCapability(
      specialist!.capabilities![0]!,
    );
    const tools = capability!.capabilityTools.map(({ name }) => name);

    expect(tools).toEqual(
      expect.arrayContaining([
        "list_agents",
        "list_capabilities",
        "list_workflows",
        "read_workflow",
        "run_workflow",
        "list_loops",
        "list_intents",
        "list_todo_lists",
      ]),
    );
  });
});
