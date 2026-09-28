import { describe, expect, it } from "vitest";
import {
  appendTodoWork,
  createTodoWork,
  readTodoWork,
  updateTodoWork,
} from "@dashboard/lib/mcp/todo-work";

const actor = {
  tokenId: "token-1",
  name: "Codex",
  actorLogin: "octocat",
};
const now = "2026-09-03T08:00:00.000Z";

describe("MCP work backed by existing Todos", () => {
  it("creates a visible Todo list instead of a separate work record", () => {
    const todo = createTodoWork(
      {
        recordId: "mcp-adoption",
        title: "Adopt Kody MCP",
        objective: "Use Kody through coding agents",
        status: "active",
        summary: "Start with real use",
        tasks: ["Connect Codex", "Review findings"],
      },
      actor,
      { key: "create-adoption", hash: "hash-1" },
      now,
    );

    expect(todo).toMatchObject({
      slug: "mcp-adoption",
      title: "Adopt Kody MCP",
      description: "Use Kody through coding agents",
      items: [
        { title: "Connect Codex", completed: false },
        { title: "Review findings", completed: false },
      ],
    });
    expect(readTodoWork(todo).record).toMatchObject({
      recordId: "mcp-adoption",
      revision: 1,
      tasks: ["Connect Codex", "Review findings"],
      updatedBy: actor,
    });
  });

  it("keeps progress and evidence visible as Todo items", () => {
    const created = createTodoWork(
      {
        recordId: "mcp-adoption",
        title: "Adopt Kody MCP",
        objective: "Use Kody through coding agents",
      },
      actor,
      { key: "create-adoption", hash: "hash-1" },
      now,
    );
    const decided = appendTodoWork(
      created,
      "decision",
      { summary: "Reuse Todos", rationale: "Avoid duplicate work storage" },
      1,
      actor,
      { key: "decision-adoption", hash: "hash-2" },
      "2026-09-03T08:01:00.000Z",
    );
    const evidenced = appendTodoWork(
      decided,
      "evidence",
      { summary: "Live MCP passed", kind: "test", reference: "run-123" },
      2,
      actor,
      { key: "evidence-adoption", hash: "hash-3" },
      "2026-09-03T08:02:00.000Z",
    );

    expect(evidenced.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Decision: Reuse Todos",
          body: "Avoid duplicate work storage",
          completed: true,
        }),
        expect.objectContaining({
          title: "Evidence: Live MCP passed",
          body: "test · run-123",
          completed: true,
        }),
      ]),
    );
    expect(readTodoWork(evidenced)).toMatchObject({
      record: {
        revision: 3,
        decisions: [{ summary: "Reuse Todos" }],
        evidence: [{ reference: "run-123" }],
      },
      events: [{ type: "decision" }, { type: "evidence" }],
    });
  });

  it("updates normal Todo tasks without deleting agent history items", () => {
    const created = createTodoWork(
      {
        recordId: "mcp-adoption",
        title: "Adopt Kody MCP",
        objective: "Use Kody",
        tasks: ["Old task"],
      },
      actor,
      { key: "create-adoption", hash: "hash-1" },
      now,
    );
    const checkpointed = appendTodoWork(
      created,
      "checkpoint",
      { summary: "Initial connection passed" },
      1,
      actor,
      { key: "checkpoint-adoption", hash: "hash-2" },
      "2026-09-03T08:01:00.000Z",
    );
    const updated = updateTodoWork(
      checkpointed,
      { tasks: ["New task"], expectedRevision: 2 },
      actor,
      { key: "update-adoption", hash: "hash-3" },
      "2026-09-03T08:02:00.000Z",
    );

    expect(updated.items.map((item) => item.title)).toEqual([
      "New task",
      "Checkpoint: Initial connection passed",
    ]);
    expect(readTodoWork(updated).record.revision).toBe(3);
  });
});
