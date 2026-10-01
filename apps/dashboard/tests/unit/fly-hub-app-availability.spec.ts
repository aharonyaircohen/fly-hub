import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as startAgent } from "../../app/api/fly-hub/apps/agent/route";
import { POST as deploy } from "../../app/api/fly-hub/apps/route";
import { callEveStudioTool } from "@dashboard/lib/eve-studio-client";
import { spawnAppBuilder } from "@kody-ade/fly/apps/builder-client";
import { issueFlyHubEveTask } from "@dashboard/lib/fly-hub-eve-task";

vi.mock("@kody-ade/fly/hub/session", () => ({
  sameOrigin: () => true,
  requireHubConfig: () => ({
    cfg: { token: "fly-test", orgSlug: "personal", defaultRegion: "lhr" },
  }),
}));
vi.mock("@kody-ade/fly/hub/app-source", () => ({
  parsePublicGitHubRepo: () => ({ owner: "acme", repo: "site" }),
  flyHubAppName: () => "flyhub-app-acme-site-123456789abc",
  inspectPublicGitHubApp: vi.fn(async () => ({
    repository: "acme/site",
    name: "site",
    appName: "flyhub-app-acme-site-123456789abc",
    commitSha: "a".repeat(40),
    branch: "main",
    plan: { kind: "static", rootDirectory: ".", port: 8080 },
    requiredSecretNames: [],
  })),
}));
vi.mock("@kody-ade/fly/apps/machines-client", () => ({
  appExists: vi.fn(async () => true),
  listAppsByPrefix: vi.fn(async () => []),
  listMachines: vi.fn(async () => []),
  getMachineDiagnostic: vi.fn(),
}));
vi.mock("@kody-ade/fly/apps/builder-client", () => ({
  getPreviewBuilderStatus: vi.fn(async () => null),
  spawnAppBuilder: vi.fn(async () => ({ machineId: "test-builder" })),
}));
vi.mock("@dashboard/lib/eve-studio-client", () => ({
  callEveStudioTool: vi.fn(async () => ({
    invocationId: "wrun_ABC123",
    status: "working",
  })),
}));

function request(path: string, body: unknown) {
  return new NextRequest(`https://flyhub.example/api/fly-hub/apps${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const direct = {
  url: "https://github.com/acme/site",
  commitSha: "a".repeat(40),
};
describe("app availability chosen by the user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("KODY_MASTER_KEY", "33".repeat(32));
    vi.stubEnv("FLY_HUB_BUILDER_IMAGE", "registry.fly.io/test:always-on");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("preserves Always on through Eve and enforces it when the agent deploys", async () => {
    expect(
      (await startAgent(request("/agent", { ...direct, alwaysOn: true })))
        .status,
    ).toBe(202);
    const args = vi.mocked(callEveStudioTool).mock.calls[0][1];
    expect(args.message).toContain("Always on");
    expect(
      (
        await deploy(
          request("", {
            taskGrant: args.flyHubGrant,
            taskBuild: { port: 8080 },
            alwaysOn: false,
          }),
        )
      ).status,
    ).toBe(202);
    expect(spawnAppBuilder).toHaveBeenCalledWith(
      expect.objectContaining({ alwaysOn: true }),
    );
  });

  it("does not let agent deployment inputs override Sleep when idle", async () => {
    const taskGrant = issueFlyHubEveTask({
      token: "fly-test",
      orgSlug: "personal",
      repository: "acme/site",
      commitSha: direct.commitSha,
    });
    expect(
      (
        await deploy(
          request("", { taskGrant, taskBuild: { port: 8080 }, alwaysOn: true }),
        )
      ).status,
    ).toBe(202);
    expect(spawnAppBuilder).toHaveBeenCalledWith(
      expect.objectContaining({ alwaysOn: false }),
    );
  });

  it("applies Always on to direct deployments", async () => {
    expect(
      (await deploy(request("", { ...direct, alwaysOn: true }))).status,
    ).toBe(202);
    expect(spawnAppBuilder).toHaveBeenCalledWith(
      expect.objectContaining({ alwaysOn: true }),
    );
  });

  it("keeps the existing idle behavior when no option is selected", async () => {
    expect((await deploy(request("", direct))).status).toBe(202);
    expect(spawnAppBuilder).toHaveBeenCalledWith(
      expect.objectContaining({ alwaysOn: false }),
    );
  });

  it("rejects ambiguous availability values before starting work", async () => {
    expect(
      (await deploy(request("", { ...direct, alwaysOn: "yes" }))).status,
    ).toBe(400);
    expect(
      (await startAgent(request("/agent", { ...direct, alwaysOn: "yes" })))
        .status,
    ).toBe(400);
    expect(spawnAppBuilder).not.toHaveBeenCalled();
    expect(callEveStudioTool).not.toHaveBeenCalled();
  });
});
