import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/app";
const NOW = "2026-07-21T00:00:00.000Z";

describe("append idempotency", () => {
  it("chatEvents.append dedupes on idempotencyKey", async () => {
    const t = setup();
    const args = {
      tenantId: TENANT,
      sessionId: "s1",
      event: { kind: "ping" },
      idempotencyKey: "k1",
    };
    await t.mutation(api.chatEvents.append, args);
    await t.mutation(api.chatEvents.append, args);
    const rows = await t.query(api.chatEvents.since, {
      tenantId: TENANT,
      sessionId: "s1",
      afterSeq: -1,
    });
    expect(rows).toHaveLength(1);
  });

  it("chatEvents.append uses the event runId when two transports deliver the same event", async () => {
    const t = setup();
    const args = {
      tenantId: TENANT,
      sessionId: "s1",
      event: {
        event: "chat.message",
        runId: "chat-s1-message",
        payload: { content: "pong" },
      },
    };
    await t.mutation(api.chatEvents.append, args);
    await t.mutation(api.chatEvents.append, args);
    const rows = await t.query(api.chatEvents.since, {
      tenantId: TENANT,
      sessionId: "s1",
      afterSeq: -1,
    });
    expect(rows).toHaveLength(1);
  });

  it("runEvents.append dedupes on idempotencyKey", async () => {
    const t = setup();
    const args = {
      tenantId: TENANT,
      runId: "r1",
      event: { kind: "step" },
      time: NOW,
      idempotencyKey: "k1",
    };
    await t.mutation(api.runEvents.append, args);
    await t.mutation(api.runEvents.append, args);
    expect(
      await t.query(api.runEvents.listByRun, { tenantId: TENANT, runId: "r1" }),
    ).toHaveLength(1);
  });

  it("dailyLogs.append dedupes on idempotencyKey", async () => {
    const t = setup();
    const args = {
      tenantId: TENANT,
      stream: "events" as const,
      date: "2026-07-21",
      entry: { note: "x" },
      idempotencyKey: "k1",
    };
    await t.mutation(api.dailyLogs.append, args);
    await t.mutation(api.dailyLogs.append, args);
    expect(
      await t.query(api.dailyLogs.forDate, {
        tenantId: TENANT,
        stream: "events",
        date: "2026-07-21",
      }),
    ).toHaveLength(1);
  });

  it("userJourneys.appendRunEvent dedupes on idempotencyKey", async () => {
    const t = setup();
    const args = {
      tenantId: TENANT,
      runId: "r1",
      event: { kind: "step" },
      time: NOW,
      idempotencyKey: "k1",
    };
    await t.mutation(api.userJourneys.appendRunEvent, args);
    await t.mutation(api.userJourneys.appendRunEvent, args);
    const rows = await t.run((ctx) =>
      ctx.db.query("userJourneyRunEvents").collect(),
    );
    expect(rows).toHaveLength(1);
  });

  it("userJourneys.createRun returns the existing run on retry", async () => {
    const t = setup();
    const args = {
      tenantId: TENANT,
      journeyId: "j1",
      runId: "r1",
      version: 1,
      environment: "dev",
      createdAt: NOW,
    };
    const first = await t.mutation(api.userJourneys.createRun, args);
    const second = await t.mutation(api.userJourneys.createRun, args);
    expect(second).toEqual(first);
    expect(
      await t.query(api.userJourneys.listRuns, {
        tenantId: TENANT,
        journeyId: "j1",
      }),
    ).toHaveLength(1);
  });
});
