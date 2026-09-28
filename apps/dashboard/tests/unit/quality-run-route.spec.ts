import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  startWorkflow: vi.fn(),
  createGateway: vi.fn(() => "dispatch"),
  activateStoreAsset: vi.fn(async (_request: NextRequest) =>
    Response.json({
      kind: "workflow",
      slug: "quality-run",
      status: "already_local",
    }),
  ),
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    owner: "acme",
    repo: "widgets",
    token: "token",
    storeRepoUrl: "https://github.com/acme/company-store",
    storeRef: "stable",
  })),
  getUserOctokit: vi.fn(async () => ({
    rest: {
      repos: {
        get: vi.fn(async () => ({ data: { default_branch: "main" } })),
        getCommit: vi.fn(async () => ({ data: { sha: "abc123" } })),
      },
    },
  })),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "alice", githubId: 42 },
  })),
  readDashboardConfig: vi.fn(async () => ({
    doc: {
      version: 1,
      namedPreviews: [
        {
          id: "production",
          label: "Production",
          url: "https://widgets.example.com",
        },
      ],
    },
  })),
}));

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoReadAccess: h.requireKodyAuth,
  verifyRepoWriteAccess: h.requireKodyAuth,
  requireKodyAuth: h.requireKodyAuth,
  getRequestAuth: h.getRequestAuth,
  getUserOctokit: h.getUserOctokit,
  verifyActorLogin: h.verifyActorLogin,
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    quality: {
      getMap: "quality.getMap",
      listRuns: "quality.listRuns",
      createRun: "quality.createRun",
      updateRun: "quality.updateRun",
      appendRunEvent: "quality.appendRunEvent",
    },
  },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ query: h.query, mutation: h.mutation }),
}));
vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));
vi.mock("@dashboard/lib/dashboard-config/store", () => ({
  readDashboardConfig: h.readDashboardConfig,
}));
vi.mock("../../app/api/kody/store-catalog/import/route", () => ({
  POST: h.activateStoreAsset,
}));
vi.mock("@dashboard/features/workflows/server/company-workflow-loader", () => ({
  createCompanyWorkflowLoader: vi.fn(() => "loader"),
}));
vi.mock(
  "@dashboard/features/workflows/server/github-actions-engine-gateway",
  () => ({ createGitHubActionsEngineGateway: h.createGateway }),
);
vi.mock("@dashboard/features/workflows/server/start-workflow", () => ({
  startWorkflow: h.startWorkflow,
}));
vi.mock("@dashboard/lib/workflow-definitions", () => ({
  validateWorkflowDefinition: vi.fn(),
  validateWorkflowInput: vi.fn(),
}));
vi.mock(
  "@dashboard/features/workflows/server/workflow-execution-authorization",
  () => ({ workflowRequiresApproval: vi.fn(() => false) }),
);
vi.mock("@kody-ade/agency/workflow-run-approval", () => ({
  workflowRunAction: vi.fn(),
}));

import { GET, POST } from "../../app/api/kody/quality/runs/route";

function request(
  scenarioSlug = "reply-persists",
  origin = "http://127.0.0.1:3333",
  model?: string,
) {
  return new NextRequest(`${origin}/api/kody/quality/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioSlug, ...(model ? { model } : {}) }),
  });
}

describe("POST /api/kody/quality/runs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    h.query.mockResolvedValue({
      actions: [
        {
          slug: "sign-in",
          name: "Sign in",
          outcome: "The user signs in with the configured test account.",
          area: "Authentication",
          status: "active",
        },
        {
          slug: "send-message",
          name: "Send a message",
          outcome: "The user sends one chat message.",
          area: "Chat",
          status: "active",
        },
      ],
      journeys: [
        {
          slug: "sign-in",
          name: "Sign in",
          goal: "A valid test user signs in.",
          priority: "normal",
          status: "active",
          actionSlugs: ["sign-in"],
          updatedAt: "2026-08-09T12:02:00.000Z",
        },
        {
          slug: "direct-chat-persists",
          name: "Direct chat persists",
          goal: "A signed-in user can complete repository work with Kody.",
          priority: "critical",
          status: "active",
          actionSlugs: ["send-message"],
          updatedAt: "2026-08-09T12:00:00.000Z",
        },
      ],
      scenarios: [
        {
          slug: "reply-persists",
          journeySlugs: ["sign-in", "direct-chat-persists"],
          name: "Reply persists",
          kind: "persistence",
          given: "The repository is connected and the user can sign in.",
          expectedVisible: "Kody's reply remains visible after reload.",
          expectedState: "The conversation remains stored.",
          cleanup: "Remove the test conversation.",
          status: "active",
          environmentId: "production",
          updatedAt: "2026-08-09T12:00:00.000Z",
        },
      ],
    });
    h.mutation.mockResolvedValue("id-1");
    h.startWorkflow.mockResolvedValue({
      kind: "accepted",
      requestId: "run-test",
      acceptedAt: "2026-08-09T12:00:01.000Z",
    });
  });

  it("dispatches the saved Quality models for agent-driven execution", async () => {
    const response = await POST(
      request("reply-persists", "http://127.0.0.1:3333", "minimax/MiniMax-M3"),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.status).toBe("running");
    expect(h.activateStoreAsset).toHaveBeenCalledOnce();
    const activationRequest = h.activateStoreAsset.mock.calls[0]?.[0];
    expect(await activationRequest?.json()).toEqual({
      kind: "workflow",
      slug: "quality-run",
    });
    expect(h.mutation).toHaveBeenCalledWith(
      "quality.createRun",
      expect.objectContaining({
        tenantId: "acme/widgets",
        journeySlugs: ["sign-in", "direct-chat-persists"],
        scenarioSlug: "reply-persists",
        definitionUpdatedAt: "2026-08-09T12:02:00.000Z",
      }),
    );
    expect(h.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "quality-run",
        input: {
          qualityRunId: expect.stringMatching(/^run-/),
          journeys: [
            {
              slug: "sign-in",
              name: "Sign in",
              goal: "A valid test user signs in.",
              priority: "normal",
              actions: [
                {
                  slug: "sign-in",
                  name: "Sign in",
                  outcome:
                    "The user signs in with the configured test account.",
                  area: "Authentication",
                },
              ],
            },
            {
              slug: "direct-chat-persists",
              name: "Direct chat persists",
              goal: "A signed-in user can complete repository work with Kody.",
              priority: "critical",
              actions: [
                {
                  slug: "send-message",
                  name: "Send a message",
                  outcome: "The user sends one chat message.",
                  area: "Chat",
                },
              ],
            },
          ],
          scenario: {
            slug: "reply-persists",
            name: "Reply persists",
            kind: "persistence",
            given: "The repository is connected and the user can sign in.",
            expectedVisible: "Kody's reply remains visible after reload.",
            expectedState: "The conversation remains stored.",
            cleanup: "Remove the test conversation.",
          },
          targetUrl: "https://widgets.example.com",
          sourceCommit: "abc123",
        },
      }),
      expect.any(Object),
    );
    const startCommand = h.startWorkflow.mock.calls[0]?.[0];
    expect(startCommand.requestId).toBe(startCommand.input.qualityRunId);
    expect(h.createGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardUrl: "http://localhost:3333",
        storeRepoUrl: "https://github.com/acme/company-store",
        storeRef: "stable",
        model: "minimax/MiniMax-M3",
      }),
    );
    expect(h.mutation).toHaveBeenCalledWith(
      "quality.updateRun",
      expect.objectContaining({
        tenantId: "acme/widgets",
        status: "running",
      }),
    );
  });

  it("does not dispatch stored browser steps or authentication secrets", async () => {
    const response = await POST(request());

    expect(response.status).toBe(202);
    const startCommand = h.startWorkflow.mock.calls[0]?.[0];
    expect(startCommand.input).not.toHaveProperty("steps");
    expect(JSON.stringify(startCommand)).not.toContain("e2e-token");
  });

  it("records a Production environment as production", async () => {
    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(h.mutation).toHaveBeenCalledWith(
      "quality.createRun",
      expect.objectContaining({
        environment: "Production",
        targetUrl: "https://widgets.example.com",
      }),
    );
  });

  it("refuses to run an uncovered Scenario", async () => {
    h.query.mockResolvedValue({
      actions: [],
      journeys: [{ slug: "direct-chat-persists" }],
      scenarios: [
        {
          slug: "reply-persists",
          journeySlugs: ["direct-chat-persists"],
          status: "draft",
        },
      ],
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(h.startWorkflow).not.toHaveBeenCalled();
  });

  it("refuses a private repository environment URL", async () => {
    h.readDashboardConfig.mockResolvedValueOnce({
      doc: {
        version: 1,
        namedPreviews: [
          {
            id: "production",
            label: "Production",
            url: "https://127.0.0.1",
          },
        ],
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "quality_environment_unavailable",
    });
    expect(h.startWorkflow).not.toHaveBeenCalled();
  });
});

describe("GET /api/kody/quality/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.query.mockImplementation(async (query: string) =>
      query === "quality.listRuns"
        ? [{ runSlug: "reply-persists-run", status: "running" }]
        : { actions: [], journeys: [], scenarios: [] },
    );
  });

  it("returns Quality Runs through the exact runs route", async () => {
    const response = await GET(
      new NextRequest("http://127.0.0.1:3333/api/kody/quality/runs"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runs).toEqual([
      { runSlug: "reply-persists-run", status: "running" },
    ]);
  });
});
