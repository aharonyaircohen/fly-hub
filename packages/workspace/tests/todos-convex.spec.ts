import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    repoDocs: {
      get: "repoDocs:get",
      listByPrefix: "repoDocs:listByPrefix",
      save: "repoDocs:save",
      remove: "repoDocs:remove",
    },
  },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));
vi.mock("../src/github", () => ({
  getOwner: () => "acme",
  getRepo: () => "app",
  getOctokit: () => ({}),
}));

import { listTodoFiles, readTodoFile, writeTodoFile } from "../src/todos/files";

describe("Convex todo storage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists and reads tenant todo documents", async () => {
    const doc = {
      version: 1,
      title: "Ship",
      description: "",
      createdAt: "2026-01-01",
      items: [],
      agencyRequest: {
        phase: "waiting-approval",
        source: {
          kind: "guided-flow",
          instanceId: "flow-1",
          effectId: "effect-1",
        },
        requirement: {
          outcome: "Ship safely",
          activation: "On request",
          permissions: "Create a PR",
          success: "Workflow passes",
        },
        questions: [],
        plan: ["Run the workflow"],
        evidence: [],
        blockers: [],
        related: [],
      },
    };
    backend.query.mockResolvedValueOnce([
      { kind: "todo:ship", doc, updatedAt: "2026-01-02" },
    ]);
    await expect(listTodoFiles()).resolves.toMatchObject([
      { slug: "ship", title: "Ship", sha: "" },
    ]);
    backend.query.mockResolvedValueOnce({ doc, updatedAt: "2026-01-02" });
    await expect(readTodoFile("ship")).resolves.toMatchObject({
      slug: "ship",
      updatedAt: "2026-01-02",
      agencyRequest: { phase: "waiting-approval" },
    });
  });

  it("writes todo documents to Convex", async () => {
    backend.mutation.mockResolvedValue(undefined);
    await writeTodoFile({
      octokit: {} as never,
      slug: "ship",
      title: "Ship",
      description: "",
      items: [],
      createdAt: "2026-01-01",
      expectedUpdatedAt: "2026-01-02",
    });
    expect(backend.mutation).toHaveBeenCalledWith(
      "repoDocs:save",
      expect.objectContaining({
        tenantId: "acme/app",
        kind: "todo:ship",
        expectedUpdatedAt: "2026-01-02",
      }),
    );
  });
});
