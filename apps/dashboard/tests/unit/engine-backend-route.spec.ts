import { beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({
  verify: vi.fn(),
}));
const backend = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("@dashboard/lib/backend/github-actions-identity", () => ({
  bearerToken: (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null,
  verifyGitHubWorkflowIdentity: identity.verify,
}));

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));

import { POST } from "../../app/api/kody/engine/backend/route";

function request(body: unknown) {
  return new Request("http://localhost/api/kody/engine/backend", {
    method: "POST",
    headers: {
      authorization: "Bearer signed-github-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  identity.verify.mockResolvedValue({
    repository: "trusted/repo",
    workflowRef: "trusted/repo/.github/workflows/kody.yml@refs/heads/main",
    actor: "alice",
    runId: "42",
  });
});

describe("POST /api/kody/engine/backend", () => {
  it("forces every backend call to the repository signed by GitHub", async () => {
    backend.query.mockResolvedValue({ ok: true });

    const response = await POST(
      request({
        kind: "query",
        operation: "repoDocs.get",
        args: {
          tenantId: "attacker/repo",
          serviceKey: "stolen",
          kind: "variables",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(backend.query).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "trusted/repo",
      kind: "variables",
    });
  });

  it("rejects operations outside the explicit allowlist", async () => {
    const response = await POST(
      request({ kind: "mutation", operation: "users.delete", args: {} }),
    );

    expect(response.status).toBe(400);
    expect(backend.mutation).not.toHaveBeenCalled();
  });

  it("allows the live Agent to read repository Reports", async () => {
    backend.query.mockResolvedValue([{ slug: "director-repo-ci" }]);

    const response = await POST(
      request({
        kind: "query",
        operation: "reports.list",
        args: { tenantId: "attacker/repo" },
      }),
    );

    expect(response.status).toBe(200);
    expect(backend.query).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "trusted/repo",
    });
  });

  it("allows the live Agent to load and save its repository-scoped state", async () => {
    backend.query.mockResolvedValue({ agent: "director" });
    backend.mutation.mockResolvedValue(undefined);

    const readResponse = await POST(
      request({
        kind: "query",
        operation: "agentStates.get",
        args: { tenantId: "attacker/repo", agent: "director" },
      }),
    );
    const saveResponse = await POST(
      request({
        kind: "mutation",
        operation: "agentStates.save",
        args: {
          tenantId: "attacker/repo",
          agent: "director",
          status: "active",
        },
      }),
    );

    expect(readResponse.status).toBe(200);
    expect(saveResponse.status).toBe(200);
    expect(backend.query).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "trusted/repo",
      agent: "director",
    });
    expect(backend.mutation).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "trusted/repo",
      agent: "director",
      status: "active",
    });
  });

  it("allows the Engine to renew an active Loop reservation", async () => {
    backend.mutation.mockResolvedValue(undefined);

    const response = await POST(
      request({
        kind: "mutation",
        operation: "agencyModel.renewDispatch",
        args: {
          tenantId: "attacker/repo",
          idempotencyKey: "ci-repair:manual:1",
          reservationId: "reservation-1",
          leaseUntil: "2026-08-08T05:11:00.000Z",
          now: "2026-08-08T05:01:00.000Z",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(backend.mutation).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "trusted/repo",
      idempotencyKey: "ci-repair:manual:1",
      reservationId: "reservation-1",
      leaseUntil: "2026-08-08T05:11:00.000Z",
      now: "2026-08-08T05:01:00.000Z",
    });
  });

  it("allows the Engine to read and append its repository conversation", async () => {
    backend.query.mockResolvedValue({ conversation: {}, entries: [] });
    backend.mutation.mockResolvedValue("entry-1");

    const readResponse = await POST(
      request({
        kind: "query",
        operation: "conversations.get",
        args: { tenantId: "attacker/repo", conversationId: "conversation-1" },
      }),
    );
    const appendResponse = await POST(
      request({
        kind: "mutation",
        operation: "conversations.appendEntry",
        args: {
          tenantId: "attacker/repo",
          conversationId: "conversation-1",
          entryId: "entry-1",
          idempotencyKey: "entry-1",
          entry: { kind: "message", role: "assistant", content: "Done" },
        },
      }),
    );

    expect(readResponse.status).toBe(200);
    expect(appendResponse.status).toBe(200);
    expect(backend.query).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "trusted/repo",
      conversationId: "conversation-1",
    });
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "trusted/repo",
        conversationId: "conversation-1",
        entryId: "entry-1",
      }),
    );
  });

  it("allows the Engine to acquire a repository-scoped Workflow run lease", async () => {
    backend.mutation.mockResolvedValue({ acquired: true });

    const response = await POST(
      request({
        kind: "mutation",
        operation: "workflowRunLeases.acquire",
        args: {
          tenantId: "attacker/repo",
          workflowId: "release",
          runId: "run-1",
          ownerId: "worker-1",
          nowMs: 1_000,
          leaseDurationMs: 10_000,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(backend.mutation).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "trusted/repo",
      workflowId: "release",
      runId: "run-1",
      ownerId: "worker-1",
      nowMs: 1_000,
      leaseDurationMs: 10_000,
    });
  });

  it("allows the Engine to report a scheduled Loop lifecycle", async () => {
    backend.mutation.mockResolvedValue(undefined);
    const response = await POST(
      request({
        kind: "mutation",
        operation: "loopWakes.markExecution",
        args: {
          tenantId: "attacker/repo",
          wakeId: "loop-wake-registration-1",
          status: "running",
          detail: "Engine started Loop",
          updatedAt: "2026-08-19T14:53:20.000Z",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(backend.mutation).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "trusted/repo",
      wakeId: "loop-wake-registration-1",
      status: "running",
      detail: "Engine started Loop",
      updatedAt: "2026-08-19T14:53:20.000Z",
    });
  });

  it("does not expose the removed Agency Definition operation", async () => {
    const response = await POST(
      request({
        kind: "query",
        operation: "agencyModel.listDefinitions",
        args: { tenantId: "attacker/repo" },
      }),
    );

    expect(response.status).toBe(400);
    expect(backend.query).not.toHaveBeenCalled();
  });
});
