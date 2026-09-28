import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/widgets";
const ENGINE = { kind: "engine" as const, id: "memory-steward" };

async function saveRun(
  t: ReturnType<typeof setup>,
  {
    runId,
    subjectId,
    status,
    updatedAt,
    parentRunId,
  }: {
    runId: string;
    subjectId: string;
    status: string;
    updatedAt: string;
    parentRunId?: string;
  },
) {
  await t.mutation(api.agencyRuns.save, {
    tenantId: TENANT,
    runId,
    subjectType: "workflow",
    subjectId,
    run: {
      id: runId,
      status,
      output: { summary: `Evidence from ${runId}` },
      finishedAt: updatedAt,
      ...(parentRunId ? { parentRunId } : {}),
    },
    updatedAt,
  });
}

describe("memory learning run claims", () => {
  it("claims one successful non-memory run and completes it exactly once", async () => {
    const t = setup();
    await saveRun(t, {
      runId: "run-source",
      subjectId: "release",
      status: "succeeded",
      updatedAt: "2026-07-26T10:00:00.000Z",
    });
    await saveRun(t, {
      runId: "run-memory",
      subjectId: "learn-from-runs",
      status: "succeeded",
      updatedAt: "2026-07-26T11:00:00.000Z",
    });
    await saveRun(t, {
      runId: "run-active",
      subjectId: "review",
      status: "running",
      updatedAt: "2026-07-26T12:00:00.000Z",
    });
    await saveRun(t, {
      runId: "run-memory-capability",
      subjectId: "verify-memory-change",
      status: "succeeded",
      updatedAt: "2026-07-26T12:30:00.000Z",
      parentRunId: "workflow:learn-from-runs:memory-run-1",
    });

    const claimed = await t.mutation(api.memoryLearning.claimNext, {
      actor: ENGINE,
      tenantId: TENANT,
      now: "2026-07-26T13:00:00.000Z",
      leaseUntil: "2026-07-26T13:15:00.000Z",
    });

    expect(claimed?.runId).toBe("run-source");
    await expect(
      t.mutation(api.memoryLearning.claimNext, {
        actor: ENGINE,
        tenantId: TENANT,
        now: "2026-07-26T13:01:00.000Z",
        leaseUntil: "2026-07-26T13:16:00.000Z",
      }),
    ).resolves.toBeNull();

    await t.mutation(api.memoryLearning.complete, {
      actor: ENGINE,
      tenantId: TENANT,
      sourceRunId: "run-source",
      now: "2026-07-26T13:02:00.000Z",
    });
    await expect(
      t.mutation(api.memoryLearning.claimNext, {
        actor: ENGINE,
        tenantId: TENANT,
        now: "2026-07-27T13:00:00.000Z",
        leaseUntil: "2026-07-27T13:15:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  it("reclaims an expired lease but never crosses tenants", async () => {
    const t = setup();
    await saveRun(t, {
      runId: "run-expired",
      subjectId: "release",
      status: "completed",
      updatedAt: "2026-07-26T10:00:00.000Z",
    });
    await t.mutation(api.memoryLearning.claimNext, {
      actor: ENGINE,
      tenantId: TENANT,
      now: "2026-07-26T11:00:00.000Z",
      leaseUntil: "2026-07-26T11:15:00.000Z",
    });

    await expect(
      t.mutation(api.memoryLearning.claimNext, {
        actor: ENGINE,
        tenantId: TENANT,
        now: "2026-07-26T11:16:00.000Z",
        leaseUntil: "2026-07-26T11:31:00.000Z",
      }),
    ).resolves.toMatchObject({ runId: "run-expired" });
    await expect(
      t.mutation(api.memoryLearning.claimNext, {
        actor: ENGINE,
        tenantId: "other/private",
        now: "2026-07-26T11:16:00.000Z",
        leaseUntil: "2026-07-26T11:31:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  it("rejects non-Engine actors and invalid lease windows", async () => {
    const t = setup();

    await expect(
      t.mutation(api.memoryLearning.claimNext, {
        actor: { kind: "user", id: "alice" },
        tenantId: TENANT,
        now: "2026-07-26T11:00:00.000Z",
        leaseUntil: "2026-07-26T11:15:00.000Z",
      }),
    ).rejects.toThrow(/engine/i);
    await expect(
      t.mutation(api.memoryLearning.claimNext, {
        actor: ENGINE,
        tenantId: TENANT,
        now: "2026-07-26T11:15:00.000Z",
        leaseUntil: "2026-07-26T11:00:00.000Z",
      }),
    ).rejects.toThrow(/lease/i);
  });

  it("allows only the Engine run that owns the claim to finish it", async () => {
    const t = setup();
    await saveRun(t, {
      runId: "run-owned",
      subjectId: "release",
      status: "completed",
      updatedAt: "2026-07-26T10:00:00.000Z",
    });
    await t.mutation(api.memoryLearning.claimNext, {
      actor: ENGINE,
      tenantId: TENANT,
      now: "2026-07-26T11:00:00.000Z",
      leaseUntil: "2026-07-26T11:15:00.000Z",
    });

    for (const action of ["complete", "fail"] as const) {
      await expect(
        t.mutation(api.memoryLearning[action], {
          actor: { kind: "engine", id: "another-engine-run" },
          tenantId: TENANT,
          sourceRunId: "run-owned",
          now: "2026-07-26T11:01:00.000Z",
          ...(action === "fail" ? { failure: "Not this run's claim." } : {}),
        }),
      ).rejects.toThrow(/claim owner/i);
    }
  });
});
