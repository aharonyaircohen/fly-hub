import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  githubClient: {
    getOctokit: vi.fn(() => ({})),
    getOwner: vi.fn(() => "acme"),
    getRepo: vi.fn(() => "widgets"),
  },
  backend: {
    query: vi.fn(),
    mutation: vi.fn(),
  },
}));

vi.mock("@kody-ade/workspace/github", () => mocks.githubClient);
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => mocks.backend,
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: { repoDocs: { get: "get", save: "save" } },
}));

import {
  parseTodoFileContent,
  serializeTodoFileContent,
  writeTodoFile,
  type TodoFileContent,
} from "../../src/todos/files";

const createdAt = "2026-06-28T00:00:00.000Z";
const updatedAt = "2026-06-28T01:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.githubClient.getOctokit.mockReturnValue({});
  mocks.githubClient.getOwner.mockReturnValue("acme");
  mocks.githubClient.getRepo.mockReturnValue("widgets");
  mocks.backend.query.mockResolvedValue(null);
  mocks.backend.mutation.mockResolvedValue("todo-id");
});

describe("todo file content", () => {
  it("round-trips one todo list as JSON", () => {
    const description = "## Scope\n\nTrack checkout work.\n\n- verify cart";
    const content: TodoFileContent = {
      title: "Checkout work",
      description,
      createdAt,
      frontmatter: {
        title: "Checkout work",
        createdAt,
        state: "active",
        managed: true,
      },
      items: [
        {
          id: "item-1",
          title: "Verify cart",
          body: "Use the **preview**.",
          assignee: "aguy",
          completed: false,
          createdAt,
          completedAt: null,
          meta: { evidence: "cartVerified", stage: "verify" },
        },
      ],
    };

    const serialized = serializeTodoFileContent(content);
    const parsed = parseTodoFileContent(serialized, "checkout-work", updatedAt);
    const stored = JSON.parse(serialized) as Record<string, unknown>;

    expect(stored).toMatchObject({
      version: 1,
      title: "Checkout work",
      description,
      managed: true,
      state: "active",
    });
    expect(parsed).toMatchObject({
      ...content,
      frontmatter: {
        ...content.frontmatter,
        version: 1,
      },
    });
  });

  it("round-trips Agency request lifecycle metadata", () => {
    const serialized = serializeTodoFileContent({
      title: "Keep CI healthy",
      description: "Set up and prove CI Repair.",
      items: [],
      createdAt,
      agencyRequest: {
        phase: "assessing",
        source: {
          kind: "guided-flow",
          instanceId: "flow-1",
          effectId: "effect-1",
        },
        requirement: {
          outcome: "Keep CI healthy",
          activation: "When CI fails",
          permissions: "Create PRs but do not merge",
          success: "Main CI is green",
        },
        questions: [],
        plan: ["Run CI Repair"],
        execution: {
          workflowId: "ci-repair",
          input: { branch: "main", ciRunId: 123 },
        },
        evidence: ["Failed run 123 verified"],
        blockers: [],
        related: [{ kind: "workflow", id: "ci-repair" }],
      },
    });

    expect(
      parseTodoFileContent(serialized, "keep-ci-healthy", updatedAt),
    ).toMatchObject({
      agencyRequest: {
        phase: "assessing",
        source: { effectId: "effect-1" },
        execution: { workflowId: "ci-repair" },
        evidence: ["Failed run 123 verified"],
      },
    });
  });

  it("keeps a described empty list empty instead of creating a legacy item", () => {
    const serialized = serializeTodoFileContent({
      title: "Launch notes",
      description: "**Scope only**",
      createdAt,
      items: [],
    });

    const parsed = parseTodoFileContent(serialized, "launch-notes", updatedAt);

    expect(parsed.description).toBe("**Scope only**");
    expect(parsed.items).toEqual([]);
  });

  it("does not convert old markdown body files into todo items", () => {
    const parsed = parseTodoFileContent(
      [
        "---",
        'title: "Legacy list"',
        `createdAt: "${createdAt}"`,
        "---",
        "",
        "Old markdown body.",
      ].join("\n"),
      "legacy-list",
      updatedAt,
    );

    expect(parsed.description).toBe("");
    expect(parsed.items).toEqual([]);
    expect(parsed.title).toBe("legacy-list");
  });

  it("returns the written todo when a new file cannot be re-read immediately", async () => {
    const todo = await writeTodoFile({
      octokit: {} as Parameters<typeof writeTodoFile>[0]["octokit"],
      slug: "checkout-work",
      title: "Checkout work",
      description: "Track checkout work.",
      items: [
        {
          id: "item-1",
          title: "Verify cart",
          body: "",
          assignee: null,
          completed: false,
          createdAt,
          completedAt: null,
        },
      ],
      createdAt,
    });

    expect(todo).toMatchObject({
      slug: "checkout-work",
      path: "todos/checkout-work.json",
      title: "Checkout work",
      description: "Track checkout work.",
      items: [
        {
          id: "item-1",
          title: "Verify cart",
          completed: false,
        },
      ],
    });
    expect(Date.parse(todo.updatedAt)).not.toBeNaN();
    expect(mocks.backend.mutation).toHaveBeenCalledTimes(1);
  });
});
