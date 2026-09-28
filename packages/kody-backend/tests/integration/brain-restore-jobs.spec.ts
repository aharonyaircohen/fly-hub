import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import { setupWithoutKey, TEST_SERVICE_KEY } from "./helpers";

describe("Convex-owned Brain restore jobs", () => {
  it("persists a restore job and deduplicates the operation", async () => {
    const t = setupWithoutKey();
    const args = {
      serviceKey: TEST_SERVICE_KEY,
      userId: "user-123",
      githubAccount: "octocat",
      githubTokenEncrypted: "v1:encrypted",
      operationId: "operation-123",
      imageRef: "ghcr.io/acme/brain:20260906t120000z",
      reset: true,
      dashboardUrl: "https://dashboard.example",
    };
    const first = await t.mutation(api.brainRestoreJobs.enqueue, args);
    const second = await t.mutation(api.brainRestoreJobs.enqueue, args);
    expect(second).toBe(first);
    await expect(
      t.run(async (ctx) => ctx.db.query("brainRestoreJobs").collect()),
    ).resolves.toEqual([
      expect.objectContaining({
        operationId: "operation-123",
        status: "queued",
        attempts: 0,
      }),
    ]);
  });

  it("allows only one live worker lease for a restore job", async () => {
    const t = setupWithoutKey();
    const jobId = await t.mutation(api.brainRestoreJobs.enqueue, {
      serviceKey: TEST_SERVICE_KEY,
      userId: "user-lease",
      githubAccount: "octocat",
      githubTokenEncrypted: "v1:encrypted",
      operationId: "operation-lease",
      imageRef: "ghcr.io/acme/brain:lease",
      reset: true,
      dashboardUrl: "https://dashboard.example",
    });
    const first = await t.mutation(internal.brainRestoreJobs.claim, { jobId });
    const second = await t.mutation(internal.brainRestoreJobs.claim, { jobId });
    expect(first).toMatchObject({ status: "running", attempts: 1 });
    expect(first).toHaveProperty("leaseId");
    expect(first!.leaseUntilMs! - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(second).toBeNull();
  });

  it("marks an exhausted stale worker as failed instead of leaving it running", async () => {
    const t = setupWithoutKey();
    const jobId = await t.mutation(api.brainRestoreJobs.enqueue, {
      serviceKey: TEST_SERVICE_KEY,
      userId: "user-stale",
      githubAccount: "octocat",
      githubTokenEncrypted: "v1:encrypted",
      operationId: "operation-stale",
      imageRef: "ghcr.io/acme/brain:stale",
      reset: true,
      dashboardUrl: "https://dashboard.example",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, {
        status: "running",
        attempts: 3,
        updatedAt: "2000-01-01T00:00:00.000Z",
        leaseId: "expired-lease",
        leaseUntilMs: 0,
      });
    });
    await t.mutation(internal.brainRestoreJobs.requeueStale, {});
    await expect(
      t.run(async (ctx) => ctx.db.get(jobId)),
    ).resolves.toMatchObject({
      status: "failed",
      error: "Restore worker exhausted its retry budget",
    });
  });

  it("does not retry a permanent restore rejection", async () => {
    const t = setupWithoutKey();
    const jobId = await t.mutation(api.brainRestoreJobs.enqueue, {
      serviceKey: TEST_SERVICE_KEY,
      userId: "user-permanent",
      githubAccount: "octocat",
      githubTokenEncrypted: "v1:encrypted",
      operationId: "operation-permanent",
      imageRef: "ghcr.io/acme/brain:permanent",
      reset: true,
      dashboardUrl: "https://dashboard.example",
    });
    const claimed = await t.mutation(internal.brainRestoreJobs.claim, { jobId });
    await t.mutation(internal.brainRestoreJobs.finish, {
      jobId,
      leaseId: claimed!.leaseId!,
      status: "failed",
      retryable: false,
      error: "Dashboard worker rejected restore (HTTP 403)",
    });

    await expect(t.run(async (ctx) => ctx.db.get(jobId))).resolves.toMatchObject({
      status: "failed",
      attempts: 1,
    });
  });

  it("requeues a retryable restore failure within its budget", async () => {
    const t = setupWithoutKey();
    const jobId = await t.mutation(api.brainRestoreJobs.enqueue, {
      serviceKey: TEST_SERVICE_KEY,
      userId: "user-retry",
      githubAccount: "octocat",
      githubTokenEncrypted: "v1:encrypted",
      operationId: "operation-retry",
      imageRef: "ghcr.io/acme/brain:retry",
      reset: true,
      dashboardUrl: "https://dashboard.example",
    });
    const claimed = await t.mutation(internal.brainRestoreJobs.claim, { jobId });
    await t.mutation(internal.brainRestoreJobs.finish, {
      jobId,
      leaseId: claimed!.leaseId!,
      status: "failed",
      retryable: true,
      error: "Fly API timed out",
    });

    await expect(t.run(async (ctx) => ctx.db.get(jobId))).resolves.toMatchObject({
      status: "queued",
      attempts: 1,
    });
  });
});
