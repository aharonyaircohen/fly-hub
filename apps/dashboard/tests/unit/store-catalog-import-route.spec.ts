import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "app/api/kody/store-catalog/import/route.ts",
  "utf8",
);

describe("simple Store activation", () => {
  it("activates only current Store asset kinds", () => {
    for (const kind of [
      "agent",
      "capability",
      "workflow",
      "trigger",
      "loop",
      "command",
      "feature",
      "solution",
    ]) {
      expect(source).toContain(`"${kind}"`);
    }
    expect(source).not.toContain('"implementation"');
    expect(source).toContain("readStoreLoop");
    expect(source).toContain("readStoreTrigger");
  });

  it("activating a Trigger activates its target before saving the Trigger", () => {
    expect(source).toMatch(
      /if \(kind === "trigger"\)[\s\S]*await activate\([\s\S]*storeTrigger\.target\.kind[\s\S]*storeTrigger\.target\.id[\s\S]*mutateTriggers/,
    );
  });

  it("activating a Workflow also activates its one Agent and Capabilities", () => {
    expect(source).toContain("workflowDefinition.capabilities");
    expect(source).toContain("workflowDefinition.agent");
    expect(source).toContain("activeWorkflowBlockers");
  });

  it("installs and removes the Workflow file used by nested Engine dispatch", () => {
    expect(source).toContain("prepareRepositoryWorkflowFile");
    expect(source).toContain("saveRepositoryWorkflow");
    expect(source).toContain("deleteRepositoryWorkflow");
    expect(source).toMatch(
      /kind === "workflow"[\s\S]*repositoryWriteMode === "defer"[\s\S]*prepareRepositoryWorkflowFile/,
    );
    expect(source).toMatch(
      /kind === "workflow"[\s\S]*await saveRepositoryWorkflow/,
    );
    expect(source).toMatch(
      /kind === "workflow"[\s\S]*await deleteRepositoryWorkflow/,
    );
  });

  it("activating a Loop activates its target before writing the Loop", () => {
    expect(source).toMatch(
      /if \(kind === "loop"\)[\s\S]*await activate\([\s\S]*storeLoop\.loop\.target\.kind[\s\S]*storeLoop\.loop\.target\.id[\s\S]*await saveRepositoryLoop/,
    );
  });

  it("projects every Store config change into the Dashboard read model", () => {
    expect(source).toContain("saveProjectedEngineConfig");
    expect(source).toMatch(
      /await writeConfigPatch[\s\S]*await saveProjectedEngineConfig/,
    );
    expect(source).toContain("saveStoreWorkflowProjection");
    expect(source).not.toMatch(/if \(!changed\) \{\s*return/);
  });

  it("publishes executable Store definitions for Engine hydration", () => {
    expect(source).toContain("publishStoreExecutionDefinitions");
    expect(source).toContain("backendApi.definitions.publish");
    expect(source).toContain("backendApi.definitions.retire");
  });

  it("rejects invalid Workflows before installing or publishing them", () => {
    expect(source).toContain("validateWorkflowDefinition(workflow)");
    expect(source).toContain("status: 422");
    expect(source).toContain('"invalid_store_workflow"');
    expect(source).toContain("details.issues");
  });

  it("does not look for Engine built-in capabilities in the Store", () => {
    expect(source).toContain("ENGINE_BUILT_IN_CAPABILITIES,");
    expect(source).toMatch(
      /publishableCapabilitySlugs = capabilitySlugs\.filter[\s\S]*!ENGINE_BUILT_IN_CAPABILITIES\.has\(slug\)/,
    );
    expect(source).toContain("publishableCapabilitySlugs.map");
  });

  it("preflights and installs every Solution entry point", () => {
    expect(source).toContain('"solution"');
    expect(source).toContain("readStoreSolution");
    expect(source).toContain("resolveStoreSolutionTree");
    expect(source).toMatch(
      /kind === "solution"[\s\S]*solution\.entrypoints[\s\S]*await activate/,
    );
  });

  it("can prepare recipe activation without committing repository config", () => {
    expect(source).toContain(
      'repositoryWriteMode: z.enum(["commit", "defer"])',
    );
    expect(source).toContain('repositoryWriteMode === "defer"');
    expect(source).toContain("configPatch");
    expect(source).toContain("PreparedRepositoryFile");
    expect(source).toContain("prepareRepositoryLoopFile(storeLoop.loop)");
    expect(source).not.toContain(
      "Deferred Store activation cannot install Loops",
    );
  });
});
