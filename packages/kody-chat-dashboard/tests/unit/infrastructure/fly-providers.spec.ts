import { beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({
  spawnRunner: vi.fn(),
}));

const pool = vi.hoisted(() => ({
  claimFromPool: vi.fn(),
}));

const flyPreview = vi.hoisted(() => ({
  appExists: vi.fn(),
  allocateSharedIps: vi.fn(),
  createApp: vi.fn(),
  createMachine: vi.fn(),
  flyHostname: vi.fn((appName: string) => `https://${appName}.fly.dev`),
  listMachines: vi.fn(),
  startMachine: vi.fn(),
  waitForMachineStarted: vi.fn(),
}));

const builder = vi.hoisted(() => ({
  getPreviewBuilderStatus: vi.fn(),
  spawnPreviewBuilder: vi.fn(),
}));

vi.mock("@kody-ade/fly/plugin/runners/fly", () => runner);
vi.mock("@kody-ade/fly/runners/pool-client", () => pool);
vi.mock("@kody-ade/fly/plugin/previews/machines-client", () => flyPreview);
vi.mock("@kody-ade/fly/previews/builder-client", () => builder);
vi.mock("@kody-ade/fly/previews/vault-build-context", () => ({
  loadVaultContextForBuild: vi.fn(),
}));
vi.mock("@kody-ade/fly/previews/config", () => ({
  resolveFlyPreviewsForRepo: vi.fn(),
}));

import {
  flyInfrastructurePlugin,
  flyInfrastructureSelection,
} from "@kody-ade/fly/plugin";
import { flyDeploymentProvider } from "@kody-ade/fly/plugin/deployments";
import { flyBrowserProvider } from "@kody-ade/fly/plugin/browsers";
import { flyServerProvider } from "@kody-ade/fly/plugin/servers";
import {
  createInfrastructureRegistry,
} from "@kody-ade/base/infrastructure/registry";
import type { FlyContext } from "@kody-ade/fly/plugin/runners/context";
import { chatExecutionRequest } from "@kody-ade/fly/runners/execution-request-builders";

function flyContext(overrides: Partial<FlyContext> = {}): FlyContext {
  return {
    owner: "acme",
    repo: "widgets",
    account: "acme",
    engineModel: undefined,
    engineModelConfig: undefined,
    githubToken: "ghp_x",
    octokit: {} as FlyContext["octokit"],
    allSecrets: { MODEL_KEY: "secret" },
    providerTokenSource: "repo-vault",
    flyToken: "fly-token",
    flyOrgSlug: "personal",
    flyDefaultRegion: "fra",
    perfTier: "medium",
    ...overrides,
  };
}

describe("fly infrastructure providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("declare brand-neutral runtime areas and capabilities", () => {
    expect(flyServerProvider).toMatchObject({
      id: "fly",
      area: "servers",
    });
    expect(flyServerProvider.capabilities.has("run-work")).toBe(true);
    expect(flyServerProvider.capabilities.has("claim-warm-runner")).toBe(true);

    expect(flyDeploymentProvider).toMatchObject({
      id: "fly",
      area: "deployments",
    });
    expect(flyDeploymentProvider.capabilities.has("deploy-preview")).toBe(true);
    expect(flyDeploymentProvider.capabilities.has("expose-http")).toBe(true);
  });

  it("keeps provider selection explicit and refuses silent defaults", () => {
    const missing = createInfrastructureRegistry([flyInfrastructurePlugin], {});
    const installed = createInfrastructureRegistry(
      [flyInfrastructurePlugin],
      flyInfrastructureSelection,
    );

    expect(() => missing.getServerProvider()).toThrow(
      "Missing explicit infrastructure provider for servers",
    );
    expect(() => missing.getDeploymentProvider()).toThrow(
      "Missing explicit infrastructure provider for deployments",
    );
    expect(() => missing.getBrowserProvider()).toThrow(
      "Missing explicit infrastructure provider for browsers",
    );
    expect(
      createInfrastructureRegistry([flyInfrastructurePlugin], {
        browsers: flyInfrastructurePlugin.id,
      }).getBrowserProvider(),
    ).toBe(flyBrowserProvider);

    expect(installed.getInfrastructureProviders()).toMatchObject({
      servers: flyServerProvider,
      deployments: flyDeploymentProvider,
      browsers: flyBrowserProvider,
    });
  });

  it("runs compute through the existing Fly runner spawn", async () => {
    runner.spawnRunner.mockResolvedValue({
      machineId: "m-1",
      app: "kody-runner",
      region: "fra",
    });

    const input = {
      repo: "acme/widgets",
      githubToken: "ghp_x",
      runRequest: chatExecutionRequest("chat-s1", "s1"),
      flyToken: "fly-token",
    };

    const out = await flyServerProvider.run(input);

    expect(out).toMatchObject({ machineId: "m-1", region: "fra" });
    expect(runner.spawnRunner).toHaveBeenCalledWith(input);
  });

  it("claims warm compute before spawning new Fly compute", async () => {
    pool.claimFromPool.mockResolvedValue({ ok: true, machineId: "warm-1" });

    const out = await flyServerProvider.claimOrRun!(flyContext(), {
      taskId: "job-1",
      runRequest: chatExecutionRequest("chat-job-1", "job-1"),
    });

    expect(out).toEqual({ runner: "pool", machineId: "warm-1" });
    expect(runner.spawnRunner).not.toHaveBeenCalled();
    expect(pool.claimFromPool).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        repo: "acme/widgets",
        runRequest: chatExecutionRequest("chat-job-1", "job-1"),
      }),
    );
  });

  it("spawns fresh Fly compute on a pool miss and forwards runtime options", async () => {
    pool.claimFromPool.mockResolvedValue({ ok: false, reason: "empty pool" });
    runner.spawnRunner.mockResolvedValue({
      machineId: "m-fresh",
      app: "kody-runner",
      region: "fra",
    });

    const out = await flyServerProvider.claimOrRun!(flyContext(), {
      taskId: "job-2",
      runRequest: chatExecutionRequest("chat-job-2", "job-2"),
      idleExitMs: 1_000,
      hardCapMs: 5_000,
      dashboardUrl: "https://dash.test/ingest?token=t",
      ref: "develop",
    });

    expect(out).toEqual({ runner: "fly", machineId: "m-fresh" });
    expect(runner.spawnRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/widgets",
        githubToken: "ghp_x",
        runRequest: chatExecutionRequest("chat-job-2", "job-2"),
        flyToken: "fly-token",
        perfTier: "medium",
        allSecrets: { MODEL_KEY: "secret" },
        idleExitMs: 1_000,
        hardCapMs: 5_000,
        dashboardUrl: "https://dash.test/ingest?token=t",
        ref: "develop",
      }),
    );
  });

  it("propagates fresh compute spawn failures", async () => {
    pool.claimFromPool.mockResolvedValue({ ok: false, reason: "miss" });
    runner.spawnRunner.mockRejectedValue(new Error("fly api 422"));

    await expect(
      flyServerProvider.claimOrRun!(flyContext(), {
        taskId: "job-3",
        runRequest: chatExecutionRequest("chat-job-3", "job-3"),
      }),
    ).rejects.toThrow("fly api 422");
  });

  it("reads deployment status through the existing Fly preview client", async () => {
    const key = { repo: "A-Guy-educ/A-Guy-Web", pr: 325 };
    const cfg = {
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    };
    flyPreview.appExists.mockResolvedValue(true);
    flyPreview.listMachines.mockResolvedValue([
      { id: "machine-1", state: "started", region: "fra" },
    ]);

    const info = await flyDeploymentProvider.get(key, cfg);

    expect(info).toMatchObject({
      machineId: "machine-1",
      state: "running",
      url: "https://kp-866cab-523991-pr-325.fly.dev",
    });
  });
});
