import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const startAppDeployment = vi.fn();

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoWriteAccess: vi.fn(async () => ({
    auth: { owner: "test-owner", repo: "test-repo", token: "github-token" },
    actorLogin: "tester",
    octokit: {},
  })),
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ query, mutation: vi.fn() }),
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    apps: { get: "apps:get" },
    appDeployments: { list: "deployments:list" },
  },
}));
vi.mock("@kody-ade/fly/apps/config", () => ({
  resolveAppHostingConfig: () => ({ token: "fly-token" }),
}));
vi.mock("@kody-ade/fly/apps/machines-client", () => ({
  listMachines: vi.fn(async () => []),
  startMachine: vi.fn(),
  stopMachine: vi.fn(),
  waitForMachineStarted: vi.fn(),
}));
vi.mock("../../src/dashboard/lib/apps/rate-limit", () => ({
  checkAppRateLimit: vi.fn(async () => true),
}));
vi.mock("../../src/dashboard/lib/apps/deployment-service", () => ({
  startAppDeployment,
  AppDeploymentError: class extends Error {},
}));

describe("Apps lifecycle actions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockImplementation(async (operation) => {
      if (operation === "apps:get")
        return {
          appId: "app-1",
          slug: "open-notebook",
          repository: "lfnovo/open-notebook",
          provider: { appName: "open-notebook-fly" },
          detectedConfig: { kind: "dockerfile", rootDirectory: "." },
          secretNames: [],
          accessTokens: [],
          storage: [],
          exposure: "private",
        };
      if (operation === "deployments:list")
        return [
          {
            commitSha: "a".repeat(40),
            buildPlan: { kind: "dockerfile", rootDirectory: "." },
          },
        ];
      return null;
    });
    startAppDeployment.mockResolvedValue({
      deploymentId: "deployment-1",
      status: "building",
    });
  });

  it("repairs a missing Machine inside the Start request", async () => {
    const { POST } =
      await import("../../app/api/kody/apps/[slug]/actions/route");
    const response = await POST(
      new Request("http://localhost/api/kody/apps/open-notebook/actions", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      }) as never,
      { params: Promise.resolve({ slug: "open-notebook" }) },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      status: "deploying",
      repairing: true,
    });
    expect(startAppDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        commitSha: "a".repeat(40),
        action: "start_repair",
      }),
    );
  });
});
