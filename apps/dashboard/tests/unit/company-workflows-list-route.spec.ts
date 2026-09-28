import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  getRequestAuth: vi.fn(),
  getUserOctokit: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  getEngineConfig: vi.fn(),
  listWorkflowDefinitionFiles: vi.fn(),
  listCompanyStoreWorkflowDefinitionFiles: vi.fn(),
  reconcileProjectedStoreWorkflows: vi.fn(),
  workflowAutomationEligibility: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: h.requireKodyAuth,
  getRequestAuth: h.getRequestAuth,
  getUserOctokit: h.getUserOctokit,
  verifyActorLogin: vi.fn(),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
}));

vi.mock("@kody-ade/base/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
}));

vi.mock("@dashboard/lib/workflow-definition-files", () => ({
  listWorkflowDefinitionFiles: h.listWorkflowDefinitionFiles,
  listCompanyStoreWorkflowDefinitionFiles:
    h.listCompanyStoreWorkflowDefinitionFiles,
  readWorkflowDefinitionFile: vi.fn(),
  writeWorkflowDefinitionFile: vi.fn(),
}));

vi.mock("@dashboard/lib/backend/repo-projection", () => ({
  reconcileProjectedStoreWorkflows: h.reconcileProjectedStoreWorkflows,
}));

vi.mock(
  "@dashboard/features/workflows/server/workflow-execution-authorization",
  () => ({
    workflowAutomationEligibility: h.workflowAutomationEligibility,
  }),
);

vi.mock("@dashboard/lib/capabilities/files", () => ({
  listLocalCapabilityFiles: vi.fn(),
}));

import { GET } from "../../app/api/kody/company/workflows/route";

function request() {
  return new NextRequest("https://dash.test/api/kody/company/workflows", {
    headers: {
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
  });
}

describe("GET /api/kody/company/workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.getRequestAuth.mockReturnValue({
      token: "ghp_test-token",
      owner: "acme",
      repo: "widgets",
    });
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.listWorkflowDefinitionFiles.mockResolvedValue([]);
    h.listCompanyStoreWorkflowDefinitionFiles.mockResolvedValue([
      {
        id: "learn-from-runs",
        source: "store",
        workflow: {
          name: "Learn from Runs",
          agent: "memory-steward",
          capabilities: ["extract-run-learning"],
        },
      },
    ]);
    h.reconcileProjectedStoreWorkflows.mockResolvedValue(undefined);
    h.workflowAutomationEligibility.mockResolvedValue(
      new Map([
        ["learn-from-runs", { eligible: false, reason: "approval-required" }],
      ]),
    );
  });

  it("uses the repository config to select active Store workflows", async () => {
    h.getEngineConfig.mockResolvedValue({
      config: {
        company: {
          activeWorkflows: ["learn-from-runs"],
        },
      },
      sha: "config-sha",
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflows).toEqual([
      expect.objectContaining({
        id: "learn-from-runs",
        source: "store",
        automation: { eligible: false, reason: "approval-required" },
      }),
    ]);
    expect(h.workflowAutomationEligibility).toHaveBeenCalledWith([
      expect.objectContaining({ id: "learn-from-runs" }),
    ]);
    expect(h.getEngineConfig).toHaveBeenCalledWith(
      { rest: {} },
      "acme",
      "widgets",
    );
    expect(h.reconcileProjectedStoreWorkflows).toHaveBeenCalledWith(
      "acme",
      "widgets",
      [
        expect.objectContaining({
          id: "learn-from-runs",
          source: "store",
        }),
      ],
    );
  });
});
