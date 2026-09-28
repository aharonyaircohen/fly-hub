import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkflowApprovalChallenge } from "@kody-ade/agency/workflow-run-approval";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "widgets",
  })),
  getUserOctokit: vi.fn(async () => ({})),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "octo", avatar_url: "", githubId: 42 },
  })),
}));
const githubClient = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));
const engineConfig = vi.hoisted(() => ({ getEngineConfig: vi.fn() }));
const workflowFiles = vi.hoisted(() => ({
  readWorkflowDefinitionFile: vi.fn(),
  readCompanyStoreWorkflowDefinitionFile: vi.fn(),
}));
const approvals = vi.hoisted(() => ({
  grantStoredAgencyApproval: vi.fn(async () => undefined),
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@dashboard/lib/github-client", () => githubClient);
vi.mock("@kody-ade/base/engine/config", () => engineConfig);
vi.mock("@dashboard/lib/workflow-definition-files", () => workflowFiles);
vi.mock("@kody-ade/agency/agency-approvals", () => approvals);

import { POST } from "../../app/api/kody/company/workflows/[id]/approve/route";

const input = { issue: 42 };

function request(approvalToken: string, workflowInput = input) {
  return new NextRequest(
    "https://dash.test/api/kody/company/workflows/documentation-agency/approve",
    {
      method: "POST",
      body: JSON.stringify({ approvalToken, input: workflowInput }),
    },
  );
}

const params = {
  params: Promise.resolve({ id: "documentation-agency" }),
};

describe("POST /api/kody/company/workflows/:id/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("KODY_SERVICE_KEY", "server-only-test-key");
    engineConfig.getEngineConfig.mockResolvedValue({
      config: { company: { activeWorkflows: ["documentation-agency"] } },
    });
    workflowFiles.readWorkflowDefinitionFile.mockResolvedValue(null);
    workflowFiles.readCompanyStoreWorkflowDefinitionFile.mockResolvedValue({
      id: "documentation-agency",
      path: "catalog/workflows/documentation-agency/workflow.json",
      source: "store",
      readOnly: true,
      runnable: true,
      workflow: {
        name: "Documentation Agency",
        agent: "documentation-lead",
        capabilities: ["define-documentation-brief"],
        steps: [
          {
            id: "define-brief",
            capability: "define-documentation-brief",
          },
        ],
        inputSchema: {
          type: "object",
          properties: { issue: { type: "integer", minimum: 1 } },
          required: ["issue"],
          additionalProperties: false,
        },
      },
    });
  });

  it("records a server-issued approval for the exact run", async () => {
    const challenge = createWorkflowApprovalChallenge({
      owner: "acme",
      repo: "widgets",
      actor: "github:42",
      workflowId: "documentation-agency",
      input,
      signingKey: "server-only-test-key",
      approvalId: "approval-one",
    });

    const response = await POST(request(challenge.token), params);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      approvalId: "approval-one",
    });
    expect(approvals.grantStoredAgencyApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        approvalId: "approval-one",
        scopeKind: "workflow",
        scopeId: "documentation-agency",
        approvedBy: "github:42",
        expiresAt: challenge.expiresAt,
      }),
    );
  });

  it("rejects a challenge reused with different input", async () => {
    const challenge = createWorkflowApprovalChallenge({
      owner: "acme",
      repo: "widgets",
      actor: "github:42",
      workflowId: "documentation-agency",
      input,
      signingKey: "server-only-test-key",
    });

    const response = await POST(
      request(challenge.token, { issue: 43 }),
      params,
    );

    expect(response.status).toBe(409);
    expect(approvals.grantStoredAgencyApproval).not.toHaveBeenCalled();
  });
});
