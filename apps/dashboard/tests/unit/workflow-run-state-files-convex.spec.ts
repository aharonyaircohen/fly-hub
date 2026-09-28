/**
 * Unit tests for the Convex-backed workflow run state reader
 * (src/dashboard/lib/workflow-run-state-files.ts): workflowRuns get/list
 * with the right tenantId, latest-run selection, and id validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const convex = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = convex.query;
    mutation = convex.mutation;
  },
}));

import { _resetConvexClient } from "@dashboard/lib/backend/convex-backend";
import {
  readLatestWorkflowRunStateFile,
  readWorkflowRunStateFile,
} from "@dashboard/lib/workflow-run-state-files";

const RUN_STATE = {
  version: 1,
  workflowId: "release",
  runId: "run-b2",
  status: "running",
  startedAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-02T00:05:00.000Z",
  steps: [],
};


beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("workflow run state convex reads", () => {
  it("reads one run via workflowRuns.get", async () => {
    convex.query.mockResolvedValue({ runId: "run-b2", state: RUN_STATE });

    const record = await readWorkflowRunStateFile(
      "acme",
      "widgets",
      "release",
      "run-b2",
    );

    expect(record?.workflowId).toBe("release");
    expect(record?.runId).toBe("run-b2");
    expect(record).not.toHaveProperty("runner");
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("workflowRuns:get");
    expect(args).toEqual({
      tenantId: "acme/widgets",
      workflowId: "release",
      runId: "run-b2",
    });
  });

  it("returns null when the run does not exist", async () => {
    convex.query.mockResolvedValue(null);
    const record = await readWorkflowRunStateFile(
      "acme",
      "widgets",
      "release",
      "run-b2",
    );
    expect(record).toBeNull();
  });

  it("rejects invalid workflow/run ids", async () => {
    await expect(
      readWorkflowRunStateFile("acme", "widgets", "../bad", "run-a"),
    ).rejects.toThrow(/Invalid workflow or run id/);
    expect(convex.query).not.toHaveBeenCalled();
  });

  it("picks the most recently updated run from workflowRuns.list", async () => {
    convex.query.mockResolvedValue([
      {
        runId: "run-z9",
        state: { ...RUN_STATE, runId: "run-z9" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        runId: "run-a1",
        state: RUN_STATE,
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      { runId: "not-a-run", state: RUN_STATE },
    ]);

    const record = await readLatestWorkflowRunStateFile(
      "acme",
      "widgets",
      "release",
    );

    expect(record?.runId).toBe("run-a1");
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("workflowRuns:list");
    expect(args).toEqual({ tenantId: "acme/widgets", workflowId: "release" });
  });

  it("returns null when the workflow has no runs", async () => {
    convex.query.mockResolvedValue([]);
    const record = await readLatestWorkflowRunStateFile(
      "acme",
      "widgets",
      "release",
    );
    expect(record).toBeNull();
  });
});
