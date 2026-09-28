import { beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({
  verify: vi.fn(),
}));
const application = vi.hoisted(() => ({
  correct: vi.fn(),
  get: vi.fn(),
  history: vi.fn(),
  list: vi.fn(),
  remember: vi.fn(),
  search: vi.fn(),
}));
const runtime = vi.hoisted(() => ({
  create: vi.fn(() => ({
    application,
    principal: {
      actor: { kind: "engine", id: "github-actions:42" },
      tenantIds: ["trusted/repo"],
    },
    scopes: [{ kind: "repository", tenantId: "trusted/repo" }],
    tenantId: "trusted/repo",
  })),
}));

vi.mock("@dashboard/lib/backend/github-actions-identity", () => ({
  bearerToken: (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null,
  verifyGitHubWorkflowIdentity: identity.verify,
}));

vi.mock("@kody-ade/workspace/memory/runtime", () => ({
  createMemoryRuntime: runtime.create,
}));

import { POST } from "../../app/api/kody/engine/memory/route";

function request(body: unknown) {
  return new Request("http://localhost/api/kody/engine/memory", {
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

describe("POST /api/kody/engine/memory", () => {
  it("requires a valid Kody workflow identity", async () => {
    const missing = new Request("http://localhost/api/kody/engine/memory", {
      method: "POST",
      body: JSON.stringify({ action: "list" }),
    });
    expect((await POST(missing)).status).toBe(401);

    identity.verify.mockRejectedValueOnce(new Error("invalid token"));
    expect((await POST(request({ action: "list" }))).status).toBe(401);
    expect(runtime.create).not.toHaveBeenCalled();
  });

  it("creates repository memory with a server-owned Engine identity", async () => {
    application.remember.mockResolvedValue({ id: "memory-1" });

    const response = await POST(
      request({
        action: "remember",
        kind: "decision",
        title: "Use typed memory",
        summary: "The repository uses typed memory.",
        body: "Keep durable repository decisions in typed memory.",
        runId: "workflow:ci-health:source-run-1",
        reason: "A completed run proved this repository decision.",
      }),
    );

    expect(response.status).toBe(201);
    expect(runtime.create).toHaveBeenCalledWith({
      actor: { kind: "engine", id: "github-actions:42" },
      tenantId: "trusted/repo",
    });
    expect(application.remember).toHaveBeenCalledWith({
      principal: {
        actor: { kind: "engine", id: "github-actions:42" },
        tenantIds: ["trusted/repo"],
      },
      scope: { kind: "repository", tenantId: "trusted/repo" },
      kind: "decision",
      content: {
        title: "Use typed memory",
        summary: "The repository uses typed memory.",
        body: "Keep durable repository decisions in typed memory.",
      },
      evidence: [
        { source: "engine-run", id: "workflow:ci-health:source-run-1" },
      ],
      reason: "A completed run proved this repository decision.",
    });
  });

  it("lists and searches repository memory only", async () => {
    application.list.mockResolvedValue([]);
    application.search.mockResolvedValue([]);

    expect((await POST(request({ action: "list" }))).status).toBe(200);
    expect(application.list).toHaveBeenCalledWith({
      principal: expect.anything(),
      scopes: [{ kind: "repository", tenantId: "trusted/repo" }],
    });

    expect(
      (
        await POST(
          request({ action: "search", query: "typed memory", limit: 5 }),
        )
      ).status,
    ).toBe(200);
    expect(application.search).toHaveBeenCalledWith({
      principal: expect.anything(),
      scopes: [{ kind: "repository", tenantId: "trusted/repo" }],
      query: "typed memory",
      limit: 5,
    });
  });

  it("updates through the application service and preserves unchanged fields", async () => {
    application.get.mockResolvedValue({
      id: "memory-1",
      kind: "decision",
      content: {
        title: "Typed memory",
        summary: "Old summary.",
        body: "Old body.",
      },
    });
    application.correct.mockResolvedValue({ id: "memory-1" });

    const response = await POST(
      request({
        action: "update",
        memoryId: "memory-1",
        summary: "New evidence-backed summary.",
        runId: "source-run-2",
        reason: "A newer completed run superseded the old summary.",
      }),
    );

    expect(response.status).toBe(200);
    expect(application.correct).toHaveBeenCalledWith({
      principal: expect.anything(),
      memoryId: "memory-1",
      kind: "decision",
      content: {
        title: "Typed memory",
        summary: "New evidence-backed summary.",
        body: "Old body.",
      },
      evidence: [{ source: "engine-run", id: "source-run-2" }],
      reason: "A newer completed run superseded the old summary.",
    });
  });

  it("reads one memory and its revision history", async () => {
    application.get.mockResolvedValue({ id: "memory-1" });
    application.history.mockResolvedValue([{ id: "revision-1" }]);

    expect(
      (await POST(request({ action: "get", memoryId: "memory-1" }))).status,
    ).toBe(200);
    expect(
      (await POST(request({ action: "history", memoryId: "memory-1" }))).status,
    ).toBe(200);
  });

  it("rejects unsupported, personal, and delete operations", async () => {
    for (const body of [
      { action: "delete", memoryId: "memory-1" },
      { action: "remember", scope: "user" },
      { action: "unknown" },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(application.remember).not.toHaveBeenCalled();
  });
});
