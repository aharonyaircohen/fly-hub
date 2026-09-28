import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async (): Promise<NextResponse | null> => null),
  getRequestAuth: vi.fn(() => ({
    owner: "acme",
    repo: "widgets",
    token: "token",
  })),
  verifyActorLogin: vi.fn(async () => ({
    actorLogin: "octocat",
    identity: { githubId: 1 },
  })),
  getUserOctokit: vi.fn(async () => ({ rest: {} })),
}));
vi.mock("@kody-ade/base/auth", () => auth);

const lifecycle = vi.hoisted(() => ({
  startAgencyRequest: vi.fn(async (_slug, ports) => {
    await ports.read("keep-ci");
    const execution = await ports.prepare({
      workflowId: "apply-strategy",
      input: {},
      activations: [{ kind: "workflow", id: "apply-strategy" }],
    });
    await ports.dispatch(execution, "run-1");
    return { kind: "started", runId: "run-1" };
  }),
}));
vi.mock("@kody-ade/agency/agency-request-lifecycle", () => lifecycle);

const todos = vi.hoisted(() => ({
  readTodoFile: vi.fn(async () => ({
    slug: "keep-ci",
    title: "Keep CI healthy",
    description: "",
    items: [],
    createdAt: "2026-08-13T00:00:00.000Z",
    frontmatter: {},
    agencyRequest: { phase: "waiting-approval" },
  })),
  writeTodoFile: vi.fn(),
}));
vi.mock("@kody-ade/workspace/todos/files", () => todos);

const github = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));
vi.mock("@kody-ade/workspace/github", () => github);

vi.mock(
  "../../src/dashboard/features/agency/server/approved-agency-workflow",
  () => ({
    prepareApprovedAgencyExecution: vi.fn(async (execution, activate) => {
      for (const activation of execution.activations ?? []) {
        await activate(activation);
      }
      return execution;
    }),
    dispatchApprovedAgencyWorkflow: vi.fn(async () => {
      return { runId: "run-1" };
    }),
  }),
);

import { POST } from "../../app/api/kody/agency-requests/[slug]/run/route";

const request = () =>
  new NextRequest("https://dash.test/api/kody/agency-requests/keep-ci/run", {
    method: "POST",
    headers: {
      connection: "keep-alive",
      "transfer-encoding": "chunked",
    },
    body: "{}",
  });

beforeEach(() => vi.clearAllMocks());

describe("Agency request run route", () => {
  it("starts the repository-scoped request through the lifecycle owner", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          imported: true,
          status: "prepared",
          configPatch: { activeWorkflows: ["apply-strategy"] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const response = await POST(request(), {
      params: Promise.resolve({ slug: "keep-ci" }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      kind: "started",
      runId: "run-1",
    });
    expect(lifecycle.startAgencyRequest).toHaveBeenCalledWith(
      "keep-ci",
      expect.objectContaining({
        read: expect.any(Function),
        save: expect.any(Function),
        prepare: expect.any(Function),
        dispatch: expect.any(Function),
      }),
    );
    expect(github.clearGitHubContext).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        body: expect.stringContaining('"repositoryWriteMode":"defer"'),
      }),
    );
    const forwardedHeaders = new Headers(
      fetchMock.mock.calls[0]?.[1]?.headers,
    );
    expect(forwardedHeaders.has("connection")).toBe(false);
    expect(forwardedHeaders.has("transfer-encoding")).toBe(false);
  });

  it("requires authenticated Kody access", async () => {
    auth.requireKodyAuth.mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );

    const response = await POST(request(), {
      params: Promise.resolve({ slug: "keep-ci" }),
    });

    expect(response.status).toBe(401);
    expect(lifecycle.startAgencyRequest).not.toHaveBeenCalled();
  });
});
