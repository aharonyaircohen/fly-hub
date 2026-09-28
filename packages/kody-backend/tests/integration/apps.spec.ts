import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const baseApp = {
  tenantId: "acme/web",
  appId: "app_01",
  name: "Web",
  slug: "web",
  repository: "acme/web",
  branch: "main",
  rootDirectory: ".",
  detectedConfig: { kind: "node", startCommand: "pnpm start", port: 3000 },
  desiredStatus: "running" as const,
  observedStatus: "provisioning" as const,
  provider: { kind: "fly", appName: "acme-web" },
  exposure: "private" as const,
  accessTokens: [],
  secretNames: ["DATABASE_URL"],
  domains: [],
  storage: [],
  createdBy: "user_01",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
};

describe("apps", () => {
  it("creates applications as private unless public access is explicitly requested", async () => {
    const t = setup();
    await t.mutation(api.apps.create, baseApp);
    await expect(
      t.query(api.apps.get, { tenantId: baseApp.tenantId, slug: baseApp.slug }),
    ).resolves.toMatchObject({ exposure: "private" });
  });

  it("keeps apps repository-scoped and enforces slug uniqueness", async () => {
    const t = setup();
    await t.mutation(api.apps.create, baseApp);
    await t.mutation(api.apps.create, {
      ...baseApp,
      tenantId: "acme/api",
      appId: "app_02",
      repository: "acme/api",
    });

    await expect(
      t.query(api.apps.list, { tenantId: "acme/web" }),
    ).resolves.toHaveLength(1);
    await expect(
      t.mutation(api.apps.create, { ...baseApp, appId: "app_03" }),
    ).rejects.toThrow("APP_SLUG_EXISTS");
  });

  it("allows legal state transitions and rejects impossible ones", async () => {
    const t = setup();
    await t.mutation(api.apps.create, baseApp);
    await t.mutation(api.apps.transition, {
      tenantId: baseApp.tenantId,
      appId: baseApp.appId,
      observedStatus: "running",
      updatedAt: "2026-09-01T08:01:00.000Z",
    });

    await expect(
      t.mutation(api.apps.transition, {
        tenantId: baseApp.tenantId,
        appId: baseApp.appId,
        observedStatus: "provisioning",
        updatedAt: "2026-09-01T08:02:00.000Z",
      }),
    ).rejects.toThrow("INVALID_APP_TRANSITION");
  });

  it("allows provider reconciliation to recover a stale failed status", async () => {
    const t = setup();
    await t.mutation(api.apps.create, {
      ...baseApp,
      observedStatus: "failed",
    });

    await expect(
      t.mutation(api.apps.transition, {
        tenantId: baseApp.tenantId,
        appId: baseApp.appId,
        observedStatus: "running",
        updatedAt: "2026-09-01T08:03:00.000Z",
      }),
    ).resolves.toBeTruthy();
  });

  it("allows only one conflicting lifecycle action at a time", async () => {
    const t = setup();
    await t.mutation(api.apps.create, baseApp);
    await t.mutation(api.apps.beginAction, {
      tenantId: baseApp.tenantId,
      appId: baseApp.appId,
      requestId: "req-1",
      action: "deploy",
      startedAt: baseApp.updatedAt,
    });
    await expect(
      t.mutation(api.apps.beginAction, {
        tenantId: baseApp.tenantId,
        appId: baseApp.appId,
        requestId: "req-2",
        action: "stop",
        startedAt: baseApp.updatedAt,
      }),
    ).rejects.toThrow("APP_ACTION_CONFLICT");
    await t.mutation(api.apps.endAction, {
      tenantId: baseApp.tenantId,
      appId: baseApp.appId,
      requestId: "req-1",
      updatedAt: baseApp.updatedAt,
    });
    await expect(
      t.mutation(api.apps.beginAction, {
        tenantId: baseApp.tenantId,
        appId: baseApp.appId,
        requestId: "req-2",
        action: "stop",
        startedAt: baseApp.updatedAt,
      }),
    ).resolves.toBeTruthy();
  });
});

describe("app deployments and events", () => {
  it("reserves an idempotent deployment request once", async () => {
    const t = setup();
    await t.mutation(api.apps.create, baseApp);
    const deployment = {
      tenantId: baseApp.tenantId,
      appId: baseApp.appId,
      deploymentId: "dep_01",
      requestId: "request_01",
      commitSha: "a".repeat(40),
      buildPlan: { kind: "node", rootDirectory: "." },
      imageRef: "registry.fly.io/acme-web:aaaaaaaaaaaa",
      status: "queued" as const,
      stages: [],
      requestedBy: "user_01",
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
    };
    const first = await t.mutation(api.appDeployments.reserve, deployment);
    const second = await t.mutation(api.appDeployments.reserve, {
      ...deployment,
      deploymentId: "dep_duplicate",
    });

    expect(second).toEqual(first);
    await expect(
      t.query(api.appDeployments.list, {
        tenantId: baseApp.tenantId,
        appId: baseApp.appId,
      }),
    ).resolves.toHaveLength(1);
  });

  it("records append-only ordered app events", async () => {
    const t = setup();
    await t.mutation(api.apps.create, baseApp);
    await t.mutation(api.appEvents.append, {
      tenantId: baseApp.tenantId,
      appId: baseApp.appId,
      eventId: "evt_01",
      kind: "deployment.queued",
      actor: { type: "user", id: "user_01" },
      payload: { deploymentId: "dep_01" },
      timestamp: "2026-09-01T08:00:00.000Z",
    });

    await expect(
      t.query(api.appEvents.list, {
        tenantId: baseApp.tenantId,
        appId: baseApp.appId,
      }),
    ).resolves.toMatchObject([
      { eventId: "evt_01", kind: "deployment.queued" },
    ]);
  });
});
