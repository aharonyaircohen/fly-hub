import { describe, expect, it } from "vitest";

import {
  createToolExecutionCoordinator,
  createToolExecutionScope,
  isReadOnlyToolName,
} from "../../../app/api/kody/chat/kody/tool-execution-order";

describe("tool execution ordering", () => {
  it("waits for an earlier mutation before a dependent read", async () => {
    const coordinator = createToolExecutionCoordinator();
    const events: string[] = [];
    let releaseDelete!: () => void;
    const deleteFinished = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });

    const deleteTodo = coordinator.wrap("delete_todo_list", async () => {
      events.push("delete:start");
      await deleteFinished;
      events.push("delete:end");
      return { success: true };
    });
    const listTodos = coordinator.wrap("list_todo_lists", async () => {
      events.push("list");
      return { todos: [] };
    });

    const deletePromise = deleteTodo({});
    const listPromise = listTodos({});
    await Promise.resolve();

    expect(events).toEqual(["delete:start"]);
    releaseDelete();
    await Promise.all([deletePromise, listPromise]);

    expect(events).toEqual(["delete:start", "delete:end", "list"]);
  });

  it("keeps independent reads concurrent", async () => {
    const coordinator = createToolExecutionCoordinator();
    let releaseReads!: () => void;
    const readsReleased = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    let started = 0;

    const firstRead = coordinator.wrap("list_todo_lists", async () => {
      started += 1;
      await readsReleased;
      return { todos: [] };
    });
    const secondRead = coordinator.wrap("read_todo_list", async () => {
      started += 1;
      await readsReleased;
      return { todo: null };
    });

    const firstPromise = firstRead({});
    const secondPromise = secondRead({});
    await Promise.resolve();
    expect(started).toBe(2);
    releaseReads();
    await Promise.all([firstPromise, secondPromise]);
  });

  it("gives a nested specialist its own execution scope", async () => {
    const parent = createToolExecutionScope();
    const child = createToolExecutionScope();
    const childAction = child.wrap("update_repository", {
      execute: async () => ({ path: "preview-history.ts" }),
    }) as { execute(input: unknown): Promise<unknown> };
    const requestEvidence = parent.wrap("request_specialist_evidence", {
      execute: async () => childAction.execute({}),
    }) as { execute(input: unknown): Promise<unknown> };

    await expect(requestEvidence.execute({})).resolves.toEqual({
      path: "preview-history.ts",
    });
  });

  it("preserves streaming tool progress and forwards execution options", async () => {
    const scope = createToolExecutionScope();
    const controller = new AbortController();
    let receivedOptions: unknown;
    const wrapped = scope.wrap("request_specialist_evidence", {
      execute: async function* (_input: unknown, options: unknown) {
        receivedOptions = options;
        yield { status: "running" };
        yield { status: "completed" };
      },
    }) as {
      execute(
        input: unknown,
        options: unknown,
      ): AsyncIterable<Record<string, unknown>>;
    };
    const options = { abortSignal: controller.signal };
    const execution = wrapped.execute({}, options);

    expect(execution[Symbol.asyncIterator]).toBeTypeOf("function");
    const outputs: unknown[] = [];
    for await (const output of execution) outputs.push(output);

    expect(receivedOptions).toBe(options);
    expect(outputs).toEqual([
      { status: "running" },
      { status: "completed" },
    ]);
  });

  it("treats writes as mutations by default", () => {
    expect(isReadOnlyToolName("list_todo_lists")).toBe(true);
    expect(isReadOnlyToolName("read_todo_list")).toBe(true);
    expect(isReadOnlyToolName("delete_todo_list")).toBe(false);
    expect(isReadOnlyToolName("github_comment_on_issue")).toBe(false);
    expect(isReadOnlyToolName("request_specialist_evidence")).toBe(false);
  });
});
