import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  listStoredAgencyRuns: vi.fn(),
  listStoredRunEvents: vi.fn(),
}));
vi.mock("@kody-ade/agency/backend/agency-runs-store", () => backend);

import {
  listAgencyRuns,
  readAgencyRunDetail,
} from "../../src/dashboard/lib/agency-runs";

describe("simple Agency Runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists Loop, Workflow, and Capability runs with their Agent", async () => {
    backend.listStoredAgencyRuns.mockResolvedValue([
      {
        runId: "run-1",
        subjectType: "workflow",
        subjectId: "release",
        run: {
          id: "run-1",
          status: "succeeded",
          target: { kind: "workflow", id: "release" },
          agent: "developer",
          startedAt: "2026-07-05T10:00:00.000Z",
          finishedAt: "2026-07-05T10:01:00.000Z",
        },
        updatedAt: "2026-07-05T10:01:00.000Z",
      },
      {
        runId: "run-2",
        subjectType: "capability",
        subjectId: "inspect",
        run: {
          id: "run-2",
          status: "running",
          target: { kind: "capability", id: "inspect" },
          agent: "kody",
          startedAt: "2026-07-05T11:00:00.000Z",
        },
        updatedAt: "2026-07-05T11:00:00.000Z",
      },
    ]);

    const payload = await listAgencyRuns({
      octokit: {} as never,
      owner: "acme",
      repo: "app",
    });

    expect(payload.counts).toEqual({
      loop: 0,
      workflow: 1,
      capability: 1,
    });
    expect(payload.runs[1]).toMatchObject({
      kind: "workflow",
      targetId: "release",
      agent: "developer",
      status: "success",
    });
    expect(JSON.stringify(payload)).not.toContain("implementation");
  });

  it("reads only stored run events for detail", async () => {
    backend.listStoredRunEvents.mockResolvedValue([
      { event: { event: "step.done", status: "completed" } },
    ]);
    const payload = await readAgencyRunDetail({
      octokit: {} as never,
      owner: "acme",
      repo: "app",
      sourcePath: "run-1",
    });
    expect(payload.events).toEqual([
      { event: "step.done", status: "completed" },
    ]);
    expect(payload.workflowLog).toBeNull();
  });

  it("shows the Engine's current success status as successful", async () => {
    backend.listStoredAgencyRuns.mockResolvedValue([
      {
        runId: "workflow:release:run-uuid",
        subjectType: "workflow",
        subjectId: "release",
        run: {
          id: "workflow:release:run-uuid",
          status: "success",
          startedAt: "2026-08-11T08:00:00.000Z",
        },
        updatedAt: "2026-08-11T08:01:00.000Z",
      },
    ]);

    const payload = await listAgencyRuns({
      octokit: {} as never,
      owner: "acme",
      repo: "app",
    });

    expect(payload.runs[0]?.status).toBe("success");
  });
});
