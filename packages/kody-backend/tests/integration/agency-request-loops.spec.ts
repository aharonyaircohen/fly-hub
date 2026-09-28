import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/app";
const NOW = "2026-08-14T00:00:00.000Z";

function todo(phase: "monitoring" | "done", related: unknown[]) {
  return {
    version: 1,
    title: "Build healthy CI",
    description: "",
    createdAt: NOW,
    items: [],
    agencyRequest: {
      phase,
      source: {
        kind: "guided-flow",
        instanceId: "flow-1",
        effectId: "effect-1",
      },
      requirement: { outcome: "Build healthy CI" },
      questions: [],
      plan: [],
      execution: {
        workflowId: "apply-strategy",
        input: {
          blueprintId: "healthy-ci",
          installation: { configPatch: { workflows: ["ci-repair"] } },
        },
      },
      evidence: [],
      blockers: [],
      related,
    },
  };
}

describe("agency request runtime Loops", () => {
  it("derives an executable Loop from an active Todo", async () => {
    const t = setup();
    await t.mutation(api.repoDocs.save, {
      tenantId: TENANT,
      kind: "todo:build-healthy-ci",
      doc: todo("monitoring", [
        { kind: "loop", id: "agency-request-build-healthy-ci" },
        { kind: "run", id: "failed-run" },
      ]),
      updatedAt: NOW,
    });
    await t.mutation(api.workflowRuns.save, {
      tenantId: TENANT,
      workflowId: "apply-strategy",
      runId: "failed-run",
      state: {
        status: "failed",
        completedStepIds: [],
        steps: {},
        facts: {},
      },
      updatedAt: NOW,
    });

    await expect(
      t.query(api.agencyRequestLoops.list, { tenantId: TENANT }),
    ).resolves.toEqual([
      {
        id: "agency-request-build-healthy-ci",
        trigger: { type: "schedule", every: "15m" },
        target: { kind: "workflow", id: "apply-strategy" },
        input: {
          blueprintId: "healthy-ci",
          installation: { configPatch: { workflows: ["ci-repair"] } },
          agencyRequest: {
            todoSlug: "build-healthy-ci",
            outcome: "Build healthy CI",
            evidence: [],
            blockers: [],
            previousRunId: "failed-run",
          },
        },
        enabled: true,
      },
    ]);
    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("loopWakeRegistrations")
          .withIndex("by_tenant", (q) => q.eq("tenantId", TENANT))
          .collect(),
      ),
    ).resolves.toHaveLength(1);
  });

  it("removes the Loop by completing the Todo", async () => {
    const t = setup();
    await t.mutation(api.repoDocs.save, {
      tenantId: TENANT,
      kind: "todo:build-healthy-ci",
      doc: todo("monitoring", [
        { kind: "loop", id: "agency-request-build-healthy-ci" },
      ]),
      updatedAt: "2026-08-13T23:59:00.000Z",
    });
    await t.mutation(api.repoDocs.save, {
      tenantId: TENANT,
      kind: "todo:build-healthy-ci",
      doc: todo("done", []),
      updatedAt: NOW,
    });

    await expect(
      t.query(api.agencyRequestLoops.list, { tenantId: TENANT }),
    ).resolves.toEqual([]);
    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("loopWakeRegistrations")
          .withIndex("by_tenant", (q) => q.eq("tenantId", TENANT))
          .collect(),
      ),
    ).resolves.toEqual([]);
  });

  it("does not start another attempt while the current Workflow is running", async () => {
    const t = setup();
    await t.mutation(api.repoDocs.save, {
      tenantId: TENANT,
      kind: "todo:build-healthy-ci",
      doc: todo("monitoring", [
        { kind: "loop", id: "agency-request-build-healthy-ci" },
        { kind: "run", id: "active-run" },
      ]),
      updatedAt: NOW,
    });
    await t.mutation(api.workflowRuns.save, {
      tenantId: TENANT,
      workflowId: "apply-strategy",
      runId: "active-run",
      state: {
        status: "running",
        completedStepIds: [],
        steps: {},
        facts: {},
      },
      updatedAt: NOW,
    });

    await expect(
      t.query(api.agencyRequestLoops.list, { tenantId: TENANT }),
    ).resolves.toEqual([]);
  });
});

describe("task-owned wake lifecycle", () => {
  const kind = "todo:build-healthy-ci";
  const loopId = "agency-request-build-healthy-ci";
  it("keeps task schedules when an Engine snapshot omits a running task", async () => {
    const t = setup();
    await t.mutation(api.repoDocs.save, {
      tenantId: TENANT,
      kind,
      doc: todo("monitoring", [{ kind: "loop", id: loopId }]),
      updatedAt: NOW,
    });
    await t.mutation(api.loopWakes.replaceRegistrations, {
      tenantId: TENANT,
      loops: [],
      updatedAt: "2026-08-14T01:00:00.000Z",
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("loopWakeRegistrations").collect(),
    );
    expect(rows.map((row) => row.loopId)).toEqual([loopId]);
    expect(rows[0]?.nextDueAt).toBe("2026-08-14T00:15:00.000Z");
  });
  it("does not let a snapshot override the task-owned schedule", async () => {
    const t = setup();
    await t.mutation(api.repoDocs.save, {
      tenantId: TENANT,
      kind,
      doc: todo("monitoring", [{ kind: "loop", id: loopId }]),
      updatedAt: NOW,
    });
    await t.mutation(api.loopWakes.replaceRegistrations, {
      tenantId: TENANT,
      loops: [
        {
          id: loopId,
          enabled: true,
          trigger: { type: "schedule", every: "1d" },
        },
      ],
      updatedAt: NOW,
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("loopWakeRegistrations").collect(),
    );
    expect(rows[0]?.trigger).toEqual({ type: "schedule", every: "15m" });
  });
  it("synchronizes atomic saves and removals of task documents", async () => {
    const t = setup();
    const doc = todo("monitoring", [{ kind: "loop", id: loopId }]);
    await t.mutation(api.repoDocs.saveAndRemove, {
      tenantId: TENANT,
      saveKind: kind,
      doc,
      updatedAt: NOW,
      removeKind: "old-draft",
    });
    expect(
      await t.run((ctx) => ctx.db.query("loopWakeRegistrations").collect()),
    ).toHaveLength(1);
    await t.mutation(api.repoDocs.removeAndMaybeSave, {
      tenantId: TENANT,
      removeKind: kind,
    });
    expect(
      await t.run((ctx) => ctx.db.query("loopWakeRegistrations").collect()),
    ).toHaveLength(0);
    await t.mutation(api.repoDocs.removeAndMaybeSave, {
      tenantId: TENANT,
      removeKind: "draft",
      save: { kind, doc, updatedAt: NOW },
    });
    expect(
      await t.run((ctx) => ctx.db.query("loopWakeRegistrations").collect()),
    ).toHaveLength(1);
    await t.mutation(api.repoDocs.saveAndRemove, {
      tenantId: TENANT,
      saveKind: "archive",
      doc,
      updatedAt: NOW,
      removeKind: kind,
    });
    expect(
      await t.run((ctx) => ctx.db.query("loopWakeRegistrations").collect()),
    ).toHaveLength(0);
  });
});
