import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getEngineConfig: vi.fn(),
  readLocal: vi.fn(),
  readStore: vi.fn(),
  syncStoreWorkflowExecutionDefinitions: vi.fn(),
}));

vi.mock("@kody-ade/base/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
}));
vi.mock("@dashboard/lib/workflow-definition-files", () => ({
  readWorkflowDefinitionFile: h.readLocal,
  readCompanyStoreWorkflowDefinitionFile: h.readStore,
}));
vi.mock("@dashboard/lib/store-workflow-execution-sync", () => ({
  syncStoreWorkflowExecutionDefinitions:
    h.syncStoreWorkflowExecutionDefinitions,
}));

import { createCompanyWorkflowLoader } from "@dashboard/features/workflows/server/company-workflow-loader";

describe("company workflow loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.readLocal.mockResolvedValue(null);
    h.readStore.mockResolvedValue({ workflow: { name: "Quality Run" } });
    h.getEngineConfig.mockResolvedValue({
      config: { company: { activeWorkflows: [] } },
    });
  });

  it("always makes the system-owned Quality Run workflow available", async () => {
    const load = createCompanyWorkflowLoader({
      octokit: {} as never,
      owner: "acme",
      repo: "widgets",
    });

    await expect(load("quality-run")).resolves.toEqual({
      workflow: { name: "Quality Run" },
    });
    expect(h.readStore).toHaveBeenCalledWith("quality-run", {});
  });

  it("keeps the normal repository override behavior", async () => {
    h.readLocal.mockResolvedValue({ workflow: { name: "Repository Quality" } });
    const load = createCompanyWorkflowLoader({
      octokit: {} as never,
      owner: "acme",
      repo: "widgets",
    });

    await expect(load("quality-run")).resolves.toEqual({
      workflow: { name: "Repository Quality" },
    });
    expect(h.readStore).not.toHaveBeenCalled();
  });

  it("refreshes Store tools when loading for execution", async () => {
    h.getEngineConfig.mockResolvedValue({
      config: { company: { activeWorkflows: ["ci-repair"] } },
    });
    const stored = {
      source: "store",
      workflow: {
        name: "CI Repair",
        agent: "kody",
        capabilities: ["ci-health-check", "fix-ci"],
      },
    };
    h.readStore.mockResolvedValue(stored);
    const octokit = {} as never;
    const load = createCompanyWorkflowLoader({
      octokit,
      owner: "acme",
      repo: "widgets",
      syncStoreDefinitions: true,
    });

    await expect(load("ci-repair")).resolves.toBe(stored);
    expect(h.syncStoreWorkflowExecutionDefinitions).toHaveBeenCalledWith({
      octokit,
      owner: "acme",
      repo: "widgets",
      workflow: stored.workflow,
    });
  });

  it("loads one explicitly approved Store workflow without installing it", async () => {
    const stored = {
      source: "store",
      workflow: {
        name: "Apply Strategy Blueprint",
        agent: "kody",
        capabilities: ["apply-strategy"],
      },
    };
    h.readStore.mockResolvedValue(stored);
    const octokit = {} as never;
    const load = createCompanyWorkflowLoader({
      octokit,
      owner: "acme",
      repo: "widgets",
      syncStoreDefinitions: true,
      allowedStoreWorkflowIds: new Set(["apply-strategy"]),
    });

    await expect(load("apply-strategy")).resolves.toBe(stored);
    expect(h.syncStoreWorkflowExecutionDefinitions).toHaveBeenCalledWith({
      octokit,
      owner: "acme",
      repo: "widgets",
      workflow: stored.workflow,
    });
  });

  it("refreshes an explicitly approved Store workflow instead of using a stale projection", async () => {
    h.readLocal.mockResolvedValue({
      source: "store",
      workflow: {
        name: "Old Apply Strategy Blueprint",
        agent: "kody",
        capabilities: ["apply-strategy"],
      },
    });
    const stored = {
      source: "store",
      workflow: {
        name: "Apply Strategy Blueprint",
        agent: "kody",
        capabilities: ["prepare-strategy-application", "apply-strategy"],
      },
    };
    h.readStore.mockResolvedValue(stored);
    const octokit = {} as never;
    const load = createCompanyWorkflowLoader({
      octokit,
      owner: "acme",
      repo: "widgets",
      syncStoreDefinitions: true,
      allowedStoreWorkflowIds: new Set(["apply-strategy"]),
    });

    await expect(load("apply-strategy")).resolves.toBe(stored);
    expect(h.syncStoreWorkflowExecutionDefinitions).toHaveBeenCalledWith({
      octokit,
      owner: "acme",
      repo: "widgets",
      workflow: stored.workflow,
    });
  });

  it("never publishes repository-owned workflows", async () => {
    h.readLocal.mockResolvedValue({
      source: "local",
      workflow: { name: "Repository Quality" },
    });
    const load = createCompanyWorkflowLoader({
      octokit: {} as never,
      owner: "acme",
      repo: "widgets",
      syncStoreDefinitions: true,
    });

    await load("quality-run");

    expect(h.syncStoreWorkflowExecutionDefinitions).not.toHaveBeenCalled();
  });
});
