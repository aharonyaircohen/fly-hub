import { describe, expect, it } from "vitest";

import type { KodyTask, TasksResponse } from "@kody-ade/base/types";
import {
  findCachedTask,
  getCachedTasks,
  mapTaskCacheData,
} from "@dashboard/lib/tasks/cache";
import { findCachedPRCIStatus } from "@dashboard/lib/hooks/usePRCIStatus";

function task(overrides: Partial<KodyTask> = {}): KodyTask {
  return {
    id: "task-1",
    issueNumber: 702,
    title: "Task",
    body: "",
    state: "open",
    labels: [],
    column: "review",
    kodyPhase: null,
    kodyFlow: null,
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("task cache helpers", () => {
  it("reads tasks from both raw arrays and paged responses", () => {
    const rawTasks = [task({ issueNumber: 1 })];
    const pagedResponse: TasksResponse = {
      tasks: [task({ issueNumber: 2 })],
      columns: ["open", "review"],
      pagination: {
        page: 1,
        perPage: 10,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      },
    };

    expect(getCachedTasks(rawTasks)?.[0]?.issueNumber).toBe(1);
    expect(getCachedTasks(pagedResponse)?.[0]?.issueNumber).toBe(2);
  });

  it("preserves the cache shape when mapping tasks", () => {
    const pagedResponse: TasksResponse = {
      tasks: [task({ labels: [] })],
      columns: ["open", "review"],
      pagination: {
        page: 1,
        perPage: 10,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      },
    };

    const mapped = mapTaskCacheData(pagedResponse, (tasks) =>
      tasks.map((item) => ({ ...item, labels: ["kody:done"] })),
    );

    expect(Array.isArray(mapped)).toBe(false);
    expect((mapped as TasksResponse).pagination?.page).toBe(1);
    expect((mapped as TasksResponse).tasks[0]?.labels).toEqual(["kody:done"]);
  });

  it("finds PR CI status when the cached query data is paged", () => {
    const queries: Array<[readonly unknown[], KodyTask[] | TasksResponse]> = [
      [["kody-tasks", 30, false, "intake"], [task({ issueNumber: 1 })]],
      [
        ["kody-tasks", 30, false, "history", 1, 10],
        {
          tasks: [
            task({
              issueNumber: 702,
              associatedPR: {
                id: 703,
                number: 703,
                title: "Fix task",
                state: "open",
                html_url: "https://github.test/pr/703",
                head: { ref: "fix/task", sha: "abc123" },
                base: { ref: "dev" },
                merged_at: null,
                mergeable: true,
                hasConflicts: false,
                ciStatus: "success",
              },
            }),
          ],
          columns: ["open", "review"],
        },
      ],
    ];

    expect(
      findCachedTask(queries, (item) => item.issueNumber === 702),
    ).toBeDefined();
    expect(findCachedPRCIStatus(queries, 703)).toEqual({
      ciStatus: "success",
      mergeable: true,
      hasConflicts: false,
    });
  });
});
