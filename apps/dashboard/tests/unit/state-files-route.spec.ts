import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "viewer",
    owner: "acme",
    repo: "widgets",
  })),
}));
const backend = vi.hoisted(() => ({ query: vi.fn() }));
const refs = vi.hoisted(() => ({
  workflowGet: Symbol("workflowRuns:get"),
  repoDocGet: Symbol("repoDocs:get"),
}));

vi.mock("@kody-ade/base/auth", () => ({
  ...auth,
  verifyRepoReadAccess: auth.requireKodyAuth,
  verifyRepoWriteAccess: auth.requireKodyAuth,
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    workflowRuns: { get: refs.workflowGet },
    repoDocs: { get: refs.repoDocGet },
  },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));

import { GET } from "../../app/api/kody/state-files/route";

describe("GET /api/kody/state-files", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads workflow evidence from Convex", async () => {
    backend.query.mockResolvedValue({ state: { event: "done" } });
    const res = await GET(
      new NextRequest(
        "http://localhost/api/kody/state-files?path=logs/workflows/ci-health/runs/run.jsonl",
      ),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      path: "logs/workflows/ci-health/runs/run.jsonl",
      content: '{\n  "event": "done"\n}',
    });
    expect(backend.query).toHaveBeenCalledWith(refs.workflowGet, {
      tenantId: "acme/widgets",
      workflowId: "ci-health",
      runId: "run",
    });
  });

  it("reads a projected document from Convex", async () => {
    backend.query.mockResolvedValue({ doc: { enabled: true } });
    const res = await GET(
      new NextRequest(
        "http://localhost/api/kody/state-files?path=user-state/config.json",
      ),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      path: "user-state/config.json",
      content: '{\n  "enabled": true\n}',
    });
    expect(backend.query).toHaveBeenCalledWith(refs.repoDocGet, {
      tenantId: "acme/widgets",
      kind: "user-state/config.json",
    });
  });

  it("rejects unsafe paths before any backend read", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/kody/state-files?path=../secret"),
    );
    expect(res.status).toBe(400);
    expect(backend.query).not.toHaveBeenCalled();
  });
});
