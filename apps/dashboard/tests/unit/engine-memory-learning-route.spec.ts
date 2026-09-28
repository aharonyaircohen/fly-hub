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

import { POST } from "../../app/api/kody/engine/memory-learning/route";

function request(body: unknown) {
  return new Request("http://localhost/api/kody/engine/memory-learning", {
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

describe("POST /api/kody/engine/memory-learning", () => {
  it("requires a valid Kody workflow identity", async () => {
    const missing = new Request(
      "http://localhost/api/kody/engine/memory-learning",
      {
        method: "POST",
        body: JSON.stringify({ action: "claim" }),
      },
    );
    expect((await POST(missing)).status).toBe(401);

    identity.verify.mockRejectedValueOnce(new Error("invalid token"));
    expect((await POST(request({ action: "claim" }))).status).toBe(401);
    expect(backend.query).not.toHaveBeenCalled();
    expect(backend.mutation).not.toHaveBeenCalled();
  });

  it("claims a source run with a bounded server-owned lease", async () => {
    backend.mutation.mockResolvedValue({ runId: "source-run-1" });

    const response = await POST(request({ action: "claim" }));

    expect(response.status).toBe(200);
    expect(backend.mutation).toHaveBeenCalledWith(expect.anything(), {
      actor: { kind: "engine", id: "github-actions:42" },
      tenantId: "trusted/repo",
      now: expect.any(String),
      leaseUntil: expect.any(String),
    });
    const args = backend.mutation.mock.calls[0]?.[1];
    expect(Date.parse(args.leaseUntil) - Date.parse(args.now)).toBe(
      15 * 60_000,
    );
  });

  it("completes and fails only the claimed source run", async () => {
    backend.mutation.mockResolvedValue(true);

    expect(
      (await POST(request({ action: "complete", sourceRunId: "source-run-1" })))
        .status,
    ).toBe(200);
    expect(backend.mutation).toHaveBeenLastCalledWith(expect.anything(), {
      actor: { kind: "engine", id: "github-actions:42" },
      tenantId: "trusted/repo",
      sourceRunId: "source-run-1",
      now: expect.any(String),
    });

    expect(
      (
        await POST(
          request({
            action: "fail",
            sourceRunId: "source-run-1",
            failure: "Verification failed.",
          }),
        )
      ).status,
    ).toBe(200);
    expect(backend.mutation).toHaveBeenLastCalledWith(expect.anything(), {
      actor: { kind: "engine", id: "github-actions:42" },
      tenantId: "trusted/repo",
      sourceRunId: "source-run-1",
      now: expect.any(String),
      failure: "Verification failed.",
    });
  });

  it("lists recent successful run evidence for maintenance", async () => {
    backend.query.mockResolvedValue([{ runId: "source-run-1" }]);

    const response = await POST(
      request({ action: "recent-evidence", limit: 10 }),
    );

    expect(response.status).toBe(200);
    expect(backend.query).toHaveBeenCalledWith(expect.anything(), {
      actor: { kind: "engine", id: "github-actions:42" },
      tenantId: "trusted/repo",
      limit: 10,
    });
  });

  it("rejects caller-owned tenant, actor, lease, and unknown actions", async () => {
    for (const body of [
      { action: "claim", tenantId: "attacker/repo" },
      { action: "claim", actor: { kind: "user", id: "attacker" } },
      { action: "claim", leaseUntil: "2099-01-01T00:00:00.000Z" },
      { action: "unknown" },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(backend.query).not.toHaveBeenCalled();
    expect(backend.mutation).not.toHaveBeenCalled();
  });
});
