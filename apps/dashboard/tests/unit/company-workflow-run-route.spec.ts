import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "widgets",
    storeRepoUrl: "https://github.com/acme/kody-store",
    storeRef: "main",
  })),
  getUserOctokit: vi.fn(),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "octo", avatar_url: "", githubId: 42 },
  })),
}));
const githubClient = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));
const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const engineConfig = vi.hoisted(() => ({ getEngineConfig: vi.fn() }));
const workflowFiles = vi.hoisted(() => ({
  readWorkflowDefinitionFile: vi.fn(),
  readCompanyStoreWorkflowDefinitionFile: vi.fn(),
}));
const approvals = vi.hoisted(() => ({
  consumeStoredAgencyApproval: vi.fn(async () => true),
}));
const storeSync = vi.hoisted(() => ({
  syncStoreWorkflowExecutionDefinitions: vi.fn(async () => undefined),
}));
const capabilityResolution = vi.hoisted(() => ({
  unresolvedWorkflowCapabilityIssues: vi.fn(
    async (): Promise<
      Array<{ code: string; path: string; message: string }>
    > => [],
  ),
}));
const backend = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  ...auth,
  verifyRepoReadAccess: auth.requireKodyAuth,
  verifyRepoWriteAccess: auth.requireKodyAuth,
}));
vi.mock("@dashboard/lib/github-client", () => githubClient);
vi.mock("@dashboard/lib/activity/audit", () => audit);
vi.mock("@dashboard/lib/cto/trust-store", () => ({
  readTrust: vi.fn(async () => ({ capabilities: {}, subjects: {}, log: [] })),
}));
vi.mock("@kody-ade/base/engine/config", () => engineConfig);
vi.mock("@dashboard/lib/workflow-definition-files", () => workflowFiles);
vi.mock("@kody-ade/agency/backend/agency-approvals-store", () => approvals);
vi.mock("@dashboard/lib/store-workflow-execution-sync", () => storeSync);
vi.mock(
  "@dashboard/lib/capabilities/resolve-workflow",
  () => capabilityResolution,
);
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    workflowRuns: {
      get: Symbol("workflowRuns.get"),
      approveStep: Symbol("workflowRuns.approveStep"),
    },
  },
}));

import { POST } from "../../app/api/kody/company/workflows/[id]/run/route";

function request(id: string, body?: unknown): NextRequest {
  return new NextRequest(
    `https://dash.test/api/kody/company/workflows/${id}/run`,
    {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeOctokit() {
  return {
    rest: {
      repos: {
        get: vi.fn(async () => ({ data: { default_branch: "main" } })),
        getContent: vi.fn(async () => ({
          data: {
            encoding: "base64",
            content: Buffer.from(
              "on:\n  workflow_dispatch:\n    inputs:\n      runRequest:\n        type: string\n      dashboardUrl:\n        type: string\n      storeRepoUrl:\n        type: string\n      storeRef:\n        type: string\n",
            ).toString("base64"),
          },
        })),
      },
      actions: {
        createWorkflowDispatch: vi.fn(async (_input: unknown) => ({
          status: 204,
        })),
      },
    },
  };
}

const validWorkflow = {
  id: "learn-from-runs",
  path: "catalog/workflows/learn-from-runs/workflow.json",
  runnable: true,
  workflow: {
    name: "Learn from Runs",
    agent: "memory-steward",
    capabilities: ["extract-run-learning"],
    runWithoutApproval: true,
    startAt: "extract",
    steps: [
      {
        id: "extract",
        capability: "extract-run-learning",
      },
    ],
  },
  source: "store",
  readOnly: true,
};

describe("POST /api/kody/company/workflows/:id/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeSync.syncStoreWorkflowExecutionDefinitions.mockResolvedValue(
      undefined,
    );
    capabilityResolution.unresolvedWorkflowCapabilityIssues.mockResolvedValue(
      [],
    );
    vi.stubEnv("KODY_SERVICE_KEY", "server-only-test-key");
    engineConfig.getEngineConfig.mockResolvedValue({
      config: {
        company: { activeWorkflows: ["learn-from-runs"] },
      },
      sha: "config-sha",
    });
    workflowFiles.readWorkflowDefinitionFile.mockResolvedValue(null);
    workflowFiles.readCompanyStoreWorkflowDefinitionFile.mockResolvedValue(
      validWorkflow,
    );
    backend.query.mockResolvedValue(null);
    backend.mutation.mockResolvedValue("run-doc");
  });

  it("dispatches every Workflow through the provider-neutral Engine request", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    const response = await POST(
      request("learn-from-runs", {
        input: { issue: 42 },
      }),
      params("learn-from-runs"),
    );

    expect(response.status).toBe(202);
    const dispatch = octokit.rest.actions.createWorkflowDispatch.mock
      .calls[0]![0] as {
      inputs: { runRequest: string };
    };
    expect(dispatch).toMatchObject({
      owner: "acme",
      repo: "widgets",
      workflow_id: "kody.yml",
      ref: "main",
      inputs: {
        dashboardUrl: "https://dash.test",
        storeRepoUrl: "acme/kody-store",
        storeRef: "main",
      },
    });
    expect(JSON.parse(dispatch.inputs.runRequest)).toEqual({
      requestId: expect.stringMatching(/^run-/),
      target: { type: "workflow", id: "learn-from-runs" },
      intent: "run",
      source: "dashboard",
      input: { issue: 42 },
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      execution: "kody-engine",
      workflow: "learn-from-runs",
      runId: expect.stringMatching(/^run-/),
    });
    expect(audit.recordAudit).toHaveBeenCalledWith(expect.any(NextRequest), {
      action: "workflow.run",
      resource: "learn-from-runs",
      detail: "manual Engine dispatch for workflow learn-from-runs",
    });
    expect(
      storeSync.syncStoreWorkflowExecutionDefinitions,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        workflow: validWorkflow.workflow,
      }),
    );
  });

  it("preserves the workflow run id when resuming", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    await POST(
      request("learn-from-runs", {
        mode: "resume",
        runId: "run-existing",
      }),
      params("learn-from-runs"),
    );

    const dispatch = octokit.rest.actions.createWorkflowDispatch.mock
      .calls[0]![0] as {
      inputs: { runRequest: string };
    };
    expect(JSON.parse(dispatch.inputs.runRequest)).toMatchObject({
      requestId: "run-existing",
    });
  });

  it("requires a context-bound approval before resuming a paused step", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    backend.query.mockResolvedValue({
      state: {
        status: "waiting-approval",
        approval: {
          stepId: "publish",
          action: "Publish Facebook post",
          contextHash: "sha256-context",
          status: "pending",
        },
      },
    });

    const response = await POST(
      request("learn-from-runs", { mode: "resume", runId: "run-existing" }),
      params("learn-from-runs"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "approval_required",
      approvalContext: {
        runId: "run-existing",
        stepId: "publish",
        contextHash: "sha256-context",
      },
    });
    expect(octokit.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("approves the exact paused context before resuming the same run", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    backend.query.mockResolvedValue({
      state: {
        status: "waiting-approval",
        approval: {
          stepId: "publish",
          action: "Publish Facebook post",
          contextHash: "sha256-context",
          status: "pending",
        },
      },
    });

    const response = await POST(
      request("learn-from-runs", {
        mode: "resume",
        runId: "run-existing",
        approvalId: "approval-one",
        input: {
          runId: "run-existing",
          stepId: "publish",
          contextHash: "sha256-context",
        },
      }),
      params("learn-from-runs"),
    );

    expect(response.status).toBe(202);
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "acme/widgets",
        workflowId: "learn-from-runs",
        runId: "run-existing",
        stepId: "publish",
        contextHash: "sha256-context",
        approvedBy: "github:42",
      }),
    );
  });

  it("rejects invalid workflows before dispatch", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    workflowFiles.readCompanyStoreWorkflowDefinitionFile.mockResolvedValue({
      ...validWorkflow,
      workflow: {
        ...validWorkflow.workflow,
        startAt: "extract",
        steps: [
          {
            id: "extract",
            capability: "extract-run-learning",
            next: [{ to: "missing" }],
          },
        ],
      },
    });

    const response = await POST(
      request("learn-from-runs"),
      params("learn-from-runs"),
    );

    expect(response.status).toBe(409);
    expect(octokit.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("rejects a workflow whose capability cannot be resolved", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    capabilityResolution.unresolvedWorkflowCapabilityIssues.mockResolvedValue([
      {
        code: "unknown_capability",
        path: "steps[0].capability",
        message: "workflow step references a missing capability",
      },
    ]);

    const response = await POST(
      request("learn-from-runs"),
      params("learn-from-runs"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_workflow",
      issues: [expect.objectContaining({ code: "unknown_capability" })],
    });
    expect(octokit.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("requires explicit approval before dispatching an untrusted Workflow", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    workflowFiles.readCompanyStoreWorkflowDefinitionFile.mockResolvedValue({
      ...validWorkflow,
      workflow: {
        ...validWorkflow.workflow,
        runWithoutApproval: false,
      },
    });
    const response = await POST(
      request("learn-from-runs", { approved: true }),
      params("learn-from-runs"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "approval_required",
      approvalToken: expect.any(String),
    });
    expect(octokit.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("consumes a durable approval id before dispatching an untrusted Workflow", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    workflowFiles.readCompanyStoreWorkflowDefinitionFile.mockResolvedValue({
      ...validWorkflow,
      workflow: {
        ...validWorkflow.workflow,
        runWithoutApproval: false,
      },
    });

    const response = await POST(
      request("learn-from-runs", {
        approvalId: "approval-one",
        input: { issue: 42 },
      }),
      params("learn-from-runs"),
    );

    expect(response.status).toBe(202);
    expect(approvals.consumeStoredAgencyApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        approvalId: "approval-one",
        scopeKind: "workflow",
        scopeId: "learn-from-runs",
        approvedBy: "github:42",
      }),
    );
  });

  it("rejects a non-object workflow input", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);

    const response = await POST(
      request("learn-from-runs", {
        input: [42],
      }),
      params("learn-from-runs"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_input",
    });
    expect(octokit.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("rejects input that does not satisfy the Workflow contract", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    workflowFiles.readCompanyStoreWorkflowDefinitionFile.mockResolvedValue({
      ...validWorkflow,
      workflow: {
        ...validWorkflow.workflow,
        inputSchema: {
          type: "object",
          properties: { issue: { type: "integer", minimum: 1 } },
          required: ["issue"],
          additionalProperties: false,
        },
      },
    });

    const response = await POST(
      request("learn-from-runs", {
        input: { issue: "not-an-integer" },
      }),
      params("learn-from-runs"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_workflow",
      issues: [
        {
          code: "invalid_workflow_input",
          path: "input.issue",
        },
      ],
    });
    expect(octokit.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("does not dispatch when Store tools cannot be refreshed", async () => {
    const octokit = makeOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    storeSync.syncStoreWorkflowExecutionDefinitions.mockRejectedValue(
      new Error("Store Capability unavailable"),
    );

    const response = await POST(
      request("learn-from-runs", { input: { issue: 42 } }),
      params("learn-from-runs"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "dispatch_failed",
      message: "Store Capability unavailable",
    });
    expect(octokit.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });
});
