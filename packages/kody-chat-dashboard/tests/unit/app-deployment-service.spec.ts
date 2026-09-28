import { beforeEach, describe, expect, it, vi } from "vitest";

const mutation = vi.fn(async () => undefined);
const readVault = vi.fn();
const spawnAppBuilder = vi.fn();

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ mutation }),
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    apps: {
      beginAction: "apps:beginAction",
      endAction: "apps:endAction",
      patch: "apps:patch",
      transition: "apps:transition",
    },
    appDeployments: {
      reserve: "deployments:reserve",
      update: "deployments:update",
    },
  },
}));
vi.mock("@kody-ade/base/vault/store", () => ({ readVault }));
vi.mock("@kody-ade/fly/apps/config", () => ({
  resolveAppHostingConfig: () => ({
    token: "fly-token",
    orgSlug: "test-org",
    defaultRegion: "iad",
  }),
}));
vi.mock("@kody-ade/fly/apps/builder-client", () => ({ spawnAppBuilder }));
vi.mock("@kody-ade/fly/apps/access-token", () => ({
  generateAppAccessToken: () => "callback-token",
  hashAppAccessToken: (value: string) => `hash:${value}`,
}));
vi.mock("@kody-ade/fly/apps/access-ticket", () => ({
  deriveAppLaunchKey: () => Buffer.alloc(32, 1),
}));

const access = {
  auth: { owner: "owner", repo: "repo", token: "github-token" },
  actorLogin: "tester",
  octokit: {
    rest: {
      repos: {
        getCommit: vi.fn(async ({ ref }: { ref: string }) => ({
          data: { sha: ref },
        })),
      },
    },
  },
};
const app = {
  appId: "app-1",
  repository: "lfnovo/open-notebook",
  provider: { appName: "open-notebook-fly" },
  exposure: "private" as const,
  accessTokens: [{ tokenHash: "consumer-hash" }],
  secretNames: ["DATABASE_URL"],
  storage: [],
};

describe("App deployment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readVault.mockResolvedValue({
      doc: { secrets: { DATABASE_URL: { value: "database-value" } } },
    });
    spawnAppBuilder.mockResolvedValue({ machineId: "builder-1" });
  });

  it("owns the complete deployment transition", async () => {
    const { startAppDeployment } =
      await import("../../src/dashboard/lib/apps/deployment-service");
    const result = await startAppDeployment({
      access: access as never,
      tenantId: "owner/repo",
      app,
      requestId: "request-1",
      commitSha: "a".repeat(40),
      buildPlan: { kind: "dockerfile", rootDirectory: "." },
      callbackOrigin: "http://localhost:3333",
      action: "start_repair",
    });

    expect(result.status).toBe("building");
    expect(spawnAppBuilder).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: "open-notebook-fly",
        runtimeSecrets: { DATABASE_URL: "database-value" },
      }),
    );
    expect(mutation).toHaveBeenCalledWith(
      "apps:transition",
      expect.objectContaining({
        desiredStatus: "running",
        observedStatus: "deploying",
      }),
    );
  });

  it("rejects missing secrets before creating deployment state", async () => {
    readVault.mockResolvedValue({ doc: { secrets: {} } });
    const { startAppDeployment } =
      await import("../../src/dashboard/lib/apps/deployment-service");

    await expect(
      startAppDeployment({
        access: access as never,
        tenantId: "owner/repo",
        app,
        requestId: "request-2",
        commitSha: "b".repeat(40),
        buildPlan: { kind: "dockerfile", rootDirectory: "." },
        callbackOrigin: "http://localhost:3333",
        action: "start_repair",
      }),
    ).rejects.toMatchObject({
      code: "missing_app_secrets",
      status: 409,
      details: { names: ["DATABASE_URL"] },
    });
    expect(spawnAppBuilder).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });
});
