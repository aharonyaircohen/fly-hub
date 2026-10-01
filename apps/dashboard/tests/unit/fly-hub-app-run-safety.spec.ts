import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MachineInfo } from "@kody-ade/fly/apps/machines-client";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { GET as getRun } from "../../app/api/fly-hub/apps/agent/route";
import {
  GET as getPassword,
  POST as resetPassword,
  PATCH as recoverPassword,
} from "../../app/api/fly-hub/apps/[app]/password/route";
import { setHubSession } from "@kody-ade/fly/hub/session";
import { issueFlyHubEveTask } from "@dashboard/lib/fly-hub-eve-task";
import { flyHubAppName } from "@kody-ade/fly/hub/app-source";
import { encrypt } from "@kody-ade/base/vault/crypto";
vi.mock("@kody-ade/fly/hub/app-cancellation", () => ({ isAppTaskCancelled: vi.fn(async () => false), requestAppCancellation: vi.fn() }));
const mocks = vi.hoisted(() => ({
  eve: vi.fn(),
  machines: vi.fn(),
  apps: vi.fn(),
  update: vi.fn(),
  builder: vi.fn(),
}));
vi.mock("@kody-ade/fly/apps/machines-client", () => ({
  listMachines: mocks.machines,
  listAppsByPrefix: mocks.apps,
  updateMachineEnv: mocks.update,
  getMachineDiagnostic: vi.fn(async () => null),
}));
vi.mock("@kody-ade/fly/apps/builder-client", () => ({
  getPreviewBuilderStatus: mocks.builder,
}));
vi.mock("@dashboard/lib/eve-studio-client", () => ({
  callEveStudioTool: mocks.eve,
}));
const origin = "https://flyhub.example";
const app = flyHubAppName("personal", "acme", "site", ".");
const startedAt = Date.now();
function request(method = "GET", body?: unknown) {
  const grant = issueFlyHubEveTask({
    token: "fake",
    orgSlug: "personal",
    repository: "acme/site",
    commitSha: "a".repeat(40),
  });
  const handle = encrypt(
    JSON.stringify({
      invocationId: "wrun_ABC123",
      agentId: "agent_builder",
      orgSlug: "personal",
      url: "https://github.com/acme/site",
      commitSha: "a".repeat(40),
      taskGrant: grant,
      startedAt,
      expiresAt: Date.now() + 60000,
    }),
  );
  const cookie = NextResponse.json({});
  setHubSession(cookie, { token: "fake", orgSlug: "personal" });
  return new NextRequest(
    `${origin}/api/fly-hub/apps/agent?handle=${encodeURIComponent(handle)}`,
    {
      method,
      headers: {
        origin,
        host: "flyhub.example",
        "content-type": "application/json",
        cookie: cookie.cookies
          .getAll()
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
      },
      ...(body
        ? { body: JSON.stringify({ ...(body as object), runHandle: handle }) }
        : {}),
    },
  );
}
beforeEach(() => {
  vi.stubEnv("KODY_MASTER_KEY", "33".repeat(32));
  vi.clearAllMocks();
  mocks.eve.mockResolvedValue({ status: "working" });
  mocks.builder.mockResolvedValue(null);
  mocks.apps.mockResolvedValue([app]);
  mocks.machines.mockImplementation(async (name) => [
    {
      id: name === app ? "gateway" : "runtime",
      state: "started",
      region: "iad",
      createdAt: new Date(startedAt - 10000).toISOString(),
      config: {
        env:
          name === app
            ? {
                FLY_HUB_PASSWORD_HASH: createHash("sha256")
                  .update("current-password")
                  .digest("hex"),
                FLY_HUB_PASSWORD_ENCRYPTED: encrypt("current-password"),
                FLY_HUB_COMMIT_SHA: "a".repeat(40),
              }
            : {},
      },
    },
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 200 })),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("current deployment status and credentials", () => {
  it("does not treat the previous deployment as the new run's success", async () => {
    const result = await getRun(request());
    expect(result.status).toBe(200);
    const data = await result.json();
    expect(data.progress.stage).toBe("inspecting");
    expect(data.app.ready).toBe(false);
    expect(data.app.password).toBe("current-password");
  });
  it("reports Ready only for this run's healthy, completed deployment", async () => {
    mocks.eve.mockResolvedValue({ status: "completed" });
    mocks.builder.mockResolvedValue({
      state: "completed",
      createdAt: new Date(startedAt + 1000).toISOString(),
    });
    const implementation = mocks.machines.getMockImplementation()!;
    mocks.machines.mockImplementation(async (name) =>
      (await implementation(name)).map((m: MachineInfo) => ({
        ...m,
        createdAt: new Date(startedAt + 2000).toISOString(),
      })),
    );
    const data = await (await getRun(request())).json();
    expect(data.app.ready).toBe(true);
    expect(data.progress.stage).toBe("ready");
  });
  it("reports the build failure even when stopped app machines remain", async () => {
    mocks.eve.mockResolvedValue({ status: "failed" });
    mocks.builder.mockResolvedValue({
      state: "failed",
      error: "image build failed",
      createdAt: new Date(startedAt + 1000).toISOString(),
    });
    mocks.machines.mockResolvedValue([
      {
        id: "stopped",
        state: "stopped",
        region: "iad",
        config: { env: { FLY_HUB_PASSWORD_HASH: "hash" } },
      },
    ]);
    const data = await (await getRun(request())).json();
    expect(data.progress.stage).toBe("build_failed");
    expect(data.app.buildError).toBe("image build failed");
  });
});
describe("password organization scope", () => {
  it.each(["read", "reset", "recover"])(
    "rejects an out-of-organization password %s without touching its machines",
    async (action) => {
      mocks.apps.mockResolvedValue([]);
      const context = { params: Promise.resolve({ app }) };
      const result =
        action === "read"
          ? await getPassword(request(), context)
          : action === "reset"
            ? await resetPassword(request("POST", {}), context)
            : await recoverPassword(request("PATCH", {}), context);
      expect(result.status).toBe(404);
      expect(mocks.machines).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
});
