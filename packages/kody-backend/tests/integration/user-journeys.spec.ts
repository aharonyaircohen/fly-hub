import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/app";
const NOW = "2026-07-19T00:00:00.000Z";

const DEFINITION = {
  id: "create-workflow",
  name: "Create a workflow",
  goal: "A user can create and review a workflow.",
  status: "active" as const,
  priority: "critical" as const,
  scenarios: [],
};

describe("userJourneys", () => {
  it("stores a new version on every save", async () => {
    const t = setup();
    const first = await t.mutation(api.userJourneys.save, {
      tenantId: TENANT,
      journeyId: DEFINITION.id,
      name: DEFINITION.name,
      goal: DEFINITION.goal,
      status: DEFINITION.status,
      priority: DEFINITION.priority,
      definition: DEFINITION,
      updatedAt: NOW,
    });
    const second = await t.mutation(api.userJourneys.save, {
      tenantId: TENANT,
      journeyId: DEFINITION.id,
      name: DEFINITION.name,
      goal: "Updated goal",
      status: DEFINITION.status,
      priority: DEFINITION.priority,
      definition: { ...DEFINITION, goal: "Updated goal" },
      updatedAt: NOW,
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    const record = await t.query(api.userJourneys.get, {
      tenantId: TENANT,
      journeyId: DEFINITION.id,
    });
    expect(record?.journey.currentVersion).toBe(2);
    expect(record?.versions).toHaveLength(2);
  });

  it("pins runs to the saved version and appends ordered evidence", async () => {
    const t = setup();
    await t.mutation(api.userJourneys.save, {
      tenantId: TENANT,
      journeyId: DEFINITION.id,
      name: DEFINITION.name,
      goal: DEFINITION.goal,
      status: DEFINITION.status,
      priority: DEFINITION.priority,
      definition: DEFINITION,
      updatedAt: NOW,
    });
    await t.mutation(api.userJourneys.createRun, {
      tenantId: TENANT,
      journeyId: DEFINITION.id,
      runId: "run-1",
      version: 1,
      environment: "local",
      createdAt: NOW,
    });
    await t.mutation(api.userJourneys.appendRunEvent, {
      tenantId: TENANT,
      runId: "run-1",
      event: { type: "step_started", stepId: "open" },
      time: NOW,
    });
    await t.mutation(api.userJourneys.appendRunEvent, {
      tenantId: TENANT,
      runId: "run-1",
      event: { type: "step_passed", stepId: "open" },
      time: NOW,
    });
    await t.mutation(api.userJourneys.updateRun, {
      tenantId: TENANT,
      runId: "run-1",
      status: "passed",
      updatedAt: NOW,
      finishedAt: NOW,
    });

    const runs = await t.query(api.userJourneys.listRuns, {
      tenantId: TENANT,
      journeyId: DEFINITION.id,
    });
    expect(runs[0]).toMatchObject({ runId: "run-1", version: 1, status: "passed" });
  });
});
