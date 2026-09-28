import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import { setupWithoutKey, TEST_SERVICE_KEY } from "./helpers";

const NOW = "2026-08-19T11:59:00.000Z";
const SLOT = "2026-08-19T12:00:00.000Z";

async function sync(
  t: ReturnType<typeof setupWithoutKey>,
  input: { tenantId: string; loopId: string; enabled: boolean },
) {
  return t.mutation(api.loopWakes.syncRegistration, {
    serviceKey: TEST_SERVICE_KEY,
    updatedAt: NOW,
    trigger: { type: "schedule", every: "15m" },
    ...input,
  });
}

describe("Convex-owned Loop wakes", () => {
  it("drains more repositories than one batch without starvation", async () => {
    const t = setupWithoutKey();
    for (let index = 0; index < 60; index += 1) {
      await sync(t, {
        tenantId: `acme/repo-${index}`,
        loopId: "daily-check",
        enabled: true,
      });
    }

    const first = await t.mutation(internal.loopWakes.claimDue, {
      now: SLOT,
      limit: 25,
    });
    const second = await t.mutation(internal.loopWakes.claimDue, {
      now: SLOT,
      limit: 25,
    });
    const third = await t.mutation(internal.loopWakes.claimDue, {
      now: SLOT,
      limit: 25,
    });

    expect(
      new Set([...first, ...second, ...third].map((claim) => claim.tenantId))
        .size,
    ).toBe(60);
    expect([first.length, second.length, third.length]).toEqual([25, 25, 10]);
  });

  it("claims each due Loop separately", async () => {
    const t = setupWithoutKey();
    await sync(t, {
      tenantId: "acme/widgets",
      loopId: "ci-health",
      enabled: true,
    });
    await sync(t, {
      tenantId: "acme/widgets",
      loopId: "docs-health",
      enabled: true,
    });

    await expect(
      t.mutation(internal.loopWakes.claimDue, {
        now: SLOT,
        limit: 25,
      }),
    ).resolves.toEqual([
      {
        tenantId: "acme/widgets",
        loopId: "ci-health",
        scheduledFor: SLOT,
        wakeId: expect.stringMatching(/^loop-wake-[a-zA-Z0-9]+-\d+$/),
      },
      {
        tenantId: "acme/widgets",
        loopId: "docs-health",
        scheduledFor: SLOT,
        wakeId: expect.stringMatching(/^loop-wake-[a-zA-Z0-9]+-\d+$/),
      },
    ]);

    await expect(
      t.mutation(internal.loopWakes.claimDue, {
        now: SLOT,
        limit: 25,
      }),
    ).resolves.toEqual([]);
  });

  it("stops waking a repository after its final scheduled Loop is disabled", async () => {
    const t = setupWithoutKey();
    await sync(t, {
      tenantId: "acme/widgets",
      loopId: "ci-health",
      enabled: true,
    });
    await sync(t, {
      tenantId: "acme/widgets",
      loopId: "ci-health",
      enabled: false,
    });

    await expect(
      t.mutation(internal.loopWakes.claimDue, {
        now: SLOT,
        limit: 25,
      }),
    ).resolves.toEqual([]);
  });

  it("records dispatch outcomes without exposing credentials", async () => {
    const t = setupWithoutKey();
    await sync(t, {
      tenantId: "acme/widgets",
      loopId: "ci-health",
      enabled: true,
    });
    const [claim] = await t.mutation(internal.loopWakes.claimDue, {
      now: SLOT,
      limit: 25,
    });

    await t.mutation(internal.loopWakes.finishWake, {
      tenantId: claim!.tenantId,
      wakeId: claim!.wakeId,
      status: "accepted",
      detail: "runner accepted",
      now: "2026-08-19T12:00:01.000Z",
    });

    const receipt = await t.run(async (ctx) =>
      ctx.db
        .query("loopWakeReceipts")
        .withIndex("by_wake", (q) =>
          q.eq("tenantId", claim!.tenantId).eq("wakeId", claim!.wakeId),
        )
        .unique(),
    );
    expect(receipt).toMatchObject({
      tenantId: "acme/widgets",
      status: "accepted",
      detail: "runner accepted",
    });
    expect(JSON.stringify(receipt)).not.toContain("secret");
  });

  it("allows the next time slot after a failed wake", async () => {
    const t = setupWithoutKey();
    await sync(t, {
      tenantId: "acme/widgets",
      loopId: "ci-health",
      enabled: true,
    });
    const [claim] = await t.mutation(internal.loopWakes.claimDue, {
      now: SLOT,
      limit: 25,
    });
    await t.mutation(internal.loopWakes.finishWake, {
      tenantId: claim!.tenantId,
      wakeId: claim!.wakeId,
      status: "failed",
      detail: "pool unavailable",
      now: "2026-08-19T12:00:01.000Z",
    });

    await expect(
      t.mutation(internal.loopWakes.claimDue, {
        now: "2026-08-19T12:15:00.000Z",
        limit: 25,
      }),
    ).resolves.toHaveLength(1);
  });

  it("retries a failed wake in the same slot", async () => {
    const t = setupWithoutKey();
    await sync(t, {
      tenantId: "acme/widgets",
      loopId: "ci-health",
      enabled: true,
    });
    const [claim] = await t.mutation(internal.loopWakes.claimDue, {
      now: SLOT,
      limit: 25,
    });
    await t.mutation(internal.loopWakes.finishWake, {
      tenantId: claim!.tenantId,
      wakeId: claim!.wakeId,
      status: "failed",
      detail: "runner timed out",
      now: "2026-08-19T12:00:01.000Z",
    });

    await expect(
      t.mutation(internal.loopWakes.claimDue, {
        now: "2026-08-19T12:05:00.000Z",
        limit: 25,
      }),
    ).resolves.toEqual([claim]);
  });

  it("stops after three failed attempts without blocking another failed Loop", async () => {
    const t = setupWithoutKey();
    await sync(t, {
      tenantId: "acme/widgets",
      loopId: "broken",
      enabled: true,
    });
    await sync(t, {
      tenantId: "acme/widgets",
      loopId: "recoverable",
      enabled: true,
    });
    const claims = await t.mutation(internal.loopWakes.claimDue, {
      now: SLOT,
      limit: 25,
    });
    for (const claim of claims) {
      await t.mutation(internal.loopWakes.finishWake, {
        tenantId: claim.tenantId,
        wakeId: claim.wakeId,
        status: "failed",
        detail: "failed",
        now: "2026-08-19T12:00:01.000Z",
      });
    }
    await t.run(async (ctx) => {
      const broken = await ctx.db
        .query("loopWakeReceipts")
        .withIndex("by_wake", (q) =>
          q.eq("tenantId", "acme/widgets").eq("wakeId", claims[0]!.wakeId),
        )
        .unique();
      await ctx.db.patch(broken!._id, { attempt: 3 });
    });

    const retries = await t.mutation(internal.loopWakes.claimDue, {
      now: "2026-08-19T12:05:00.000Z",
      limit: 1,
    });

    expect(retries).toEqual([claims[1]]);
    const terminal = await t.run(async (ctx) =>
      ctx.db
        .query("loopWakeReceipts")
        .withIndex("by_wake", (q) =>
          q.eq("tenantId", "acme/widgets").eq("wakeId", claims[0]!.wakeId),
        )
        .unique(),
    );
    expect(terminal?.status).toBe("timed_out");
  });

  it("replaces registrations from an Engine shadow tick", async () => {
    const t = setupWithoutKey();
    await sync(t, {
      tenantId: "acme/widgets",
      loopId: "old-loop",
      enabled: true,
    });

    await t.mutation(api.loopWakes.replaceRegistrations, {
      serviceKey: TEST_SERVICE_KEY,
      tenantId: "acme/widgets",
      loops: [
        {
          id: "ci-health",
          enabled: true,
          trigger: { type: "schedule", every: "15m" },
        },
        {
          id: "docs-health",
          enabled: true,
          trigger: { type: "schedule", every: "1h" },
        },
        {
          id: "ci-health",
          enabled: true,
          trigger: { type: "schedule", every: "15m" },
        },
      ],
      updatedAt: NOW,
    });

    const registrations = await t.run(async (ctx) =>
      ctx.db
        .query("loopWakeRegistrations")
        .withIndex("by_tenant", (q) => q.eq("tenantId", "acme/widgets"))
        .collect(),
    );
    expect(registrations.map((row) => row.loopId).sort()).toEqual([
      "ci-health",
      "docs-health",
    ]);
  });
});

describe("unchanged schedule deadlines", () => {
  it("preserves an overdue wake when reconciliation reads an unchanged trigger", async () => {
    const t = setupWithoutKey();
    const loops = [
      {
        id: "hourly",
        enabled: true,
        trigger: { type: "schedule", every: "1h" },
      },
    ];
    await t.mutation(api.loopWakes.replaceRegistrations, {
      serviceKey: TEST_SERVICE_KEY,
      tenantId: "audit/repo",
      loops,
      updatedAt: "2026-09-05T00:00:00.000Z",
    });
    await t.mutation(api.loopWakes.replaceRegistrations, {
      serviceKey: TEST_SERVICE_KEY,
      tenantId: "audit/repo",
      loops,
      updatedAt: "2026-09-05T01:00:01.000Z",
    });
    const claims = await t.mutation(internal.loopWakes.claimDue, {
      now: "2026-09-05T01:00:02.000Z",
      limit: 25,
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]?.scheduledFor).toBe("2026-09-05T01:00:00.000Z");
  });
  it("reschedules a changed trigger and re-enables a disabled loop", async () => {
    const t = setupWithoutKey();
    const common = {
      serviceKey: TEST_SERVICE_KEY,
      tenantId: "audit/repo",
      loopId: "hourly",
      enabled: true,
    };
    await t.mutation(api.loopWakes.syncRegistration, {
      ...common,
      trigger: { type: "schedule", every: "1h" },
      updatedAt: "2026-09-05T00:00:00.000Z",
    });
    await t.mutation(api.loopWakes.syncRegistration, {
      ...common,
      trigger: { type: "schedule", every: "15m" },
      updatedAt: "2026-09-05T00:01:00.000Z",
    });
    const claims = await t.mutation(internal.loopWakes.claimDue, {
      now: "2026-09-05T00:15:00.000Z",
      limit: 25,
    });
    expect(claims).toHaveLength(1);
    await t.mutation(api.loopWakes.syncRegistration, {
      ...common,
      enabled: false,
      updatedAt: "2026-09-05T00:16:00.000Z",
    });
    await t.mutation(api.loopWakes.syncRegistration, {
      ...common,
      trigger: { type: "schedule", every: "1h" },
      updatedAt: "2026-09-05T02:01:00.000Z",
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("loopWakeRegistrations").collect(),
    );
    expect(rows[0]?.nextDueAt).toBe("2026-09-05T03:00:00.000Z");
  });
});
