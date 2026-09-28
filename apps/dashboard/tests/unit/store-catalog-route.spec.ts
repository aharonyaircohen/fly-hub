import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/api/kody/store-catalog/route.ts", "utf8");

describe("simple Store catalog", () => {
  it("lists only current Store asset kinds", () => {
    for (const kind of [
      "agent",
      "pipeline",
      "workflow",
      "capability",
      "loop",
      "trigger",
      "command",
      "feature",
      "blueprint",
    ]) {
      expect(source).toContain(`| "${kind}"`);
    }
    expect(source).not.toContain('"implementation"');
    expect(source).toContain("listStoreCatalogSlugs");
  });

  it("derives Agent and Capability uninstall blockers from active Workflows", () => {
    expect(source).toContain("workflowBlockers");
    expect(source).toContain("item.agent === agent");
  });

  it("loads dependency definitions through the shared Solution catalog", () => {
    expect(source).toContain("listStoreCatalogSlugs");
    expect(source).not.toContain("listStoreCapabilityFiles");
    expect(source).not.toContain("listStoreAgentFiles");
    expect(source).not.toContain("listStoreCommandFiles");
    expect(source).not.toContain("listCompanyStoreWorkflowDefinitionFiles");
    expect(source).not.toContain("listStoreLoops");
    expect(source).toContain("loadStoreSolutionCatalog");
  });

  it("uses the authenticated repository token for Store reads", () => {
    expect(source).toMatch(
      /setGitHubContext\(\s*auth\.owner,\s*auth\.repo,\s*auth\.token,/,
    );
  });

  it("returns installable Solutions with their resolved trees", () => {
    expect(source).toContain("listStoreSolutions");
    expect(source).toContain("resolveStoreSolutionTree");
    expect(source).toContain("solutions");
  });

  it("returns Strategy Blueprints as executable Store entries", () => {
    expect(source).toContain("readStoreStrategy");
    expect(source).toContain('kind: "blueprint"');
    expect(source).toContain("verification.criteria");
  });

  it("requires active Agents and Capabilities to exist in the execution backend", () => {
    expect(source).toContain("backendApi.definitions.listCurrent");
    expect(source).toContain("runnableStoreDefinitionSlugs");
    expect(source).toContain("runnableAgents");
    expect(source).toContain("runnableCapabilities");
  });
});
