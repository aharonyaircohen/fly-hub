import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const base = {
  tenantId: "acme/app",
  actorId: "octocat",
  sessionId: "browser-1",
};

describe("browser sessions", () => {
  it("allows only one distributed browser starter per actor", async () => {
    const t = setup();
    await expect(
      t.mutation(api.browserSessions.acquireStartLease, {
        tenantId: base.tenantId,
        actorId: base.actorId,
        ownerId: "request-a",
        nowMs: 1_000,
        leaseUntilMs: 31_000,
      }),
    ).resolves.toBe(true);
    await expect(
      t.mutation(api.browserSessions.acquireStartLease, {
        tenantId: base.tenantId,
        actorId: base.actorId,
        ownerId: "request-b",
        nowMs: 2_000,
        leaseUntilMs: 32_000,
      }),
    ).resolves.toBe(false);
    await expect(
      t.mutation(api.browserSessions.releaseStartLease, {
        tenantId: base.tenantId,
        actorId: base.actorId,
        ownerId: "request-b",
      }),
    ).resolves.toBe(false);
    await expect(
      t.mutation(api.browserSessions.acquireStartLease, {
        tenantId: base.tenantId,
        actorId: base.actorId,
        ownerId: "request-b",
        nowMs: 31_001,
        leaseUntilMs: 61_001,
      }),
    ).resolves.toBe(true);
  });

  it("allows only the owning actor to read, touch, and close a session", async () => {
    const t = setup();
    await t.mutation(api.browserSessions.save, {
      ...base,
      providerId: "fly",
      appName: "kody-browser-acme-app-123",
      machineId: "machine-1",
      state: "running",
      currentUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
      nowMs: 1_000,
      expiresAtMs: 61_000,
    });

    await expect(t.query(api.browserSessions.get, base)).resolves.toMatchObject(
      { machineId: "machine-1", state: "running" },
    );
    await expect(
      t.query(api.browserSessions.get, { ...base, actorId: "intruder" }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.browserSessions.touch, {
        ...base,
        actorId: "intruder",
        nowMs: 2_000,
        expiresAtMs: 62_000,
      }),
    ).resolves.toBe(false);
    await expect(
      t.mutation(api.browserSessions.close, {
        ...base,
        actorId: "intruder",
        nowMs: 3_000,
      }),
    ).resolves.toBe(false);
  });

  it("returns only the active workspace session and expires stale records", async () => {
    const t = setup();
    await t.mutation(api.browserSessions.save, {
      ...base,
      providerId: "fly",
      appName: "kody-browser-acme-app-123",
      machineId: "machine-1",
      state: "running",
      currentUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
      nowMs: 1_000,
      expiresAtMs: 2_000,
    });

    await expect(
      t.query(api.browserSessions.getActive, {
        tenantId: base.tenantId,
        actorId: base.actorId,
        nowMs: 1_500,
      }),
    ).resolves.toMatchObject({ sessionId: base.sessionId });
    await expect(
      t.query(api.browserSessions.getActive, {
        tenantId: base.tenantId,
        actorId: base.actorId,
        nowMs: 2_001,
      }),
    ).resolves.toBeNull();
  });
});
