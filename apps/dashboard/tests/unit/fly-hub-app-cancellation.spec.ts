import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as cancelRun } from "../../app/api/fly-hub/apps/agent/route";
import { POST as deploy } from "../../app/api/fly-hub/apps/route";
import { encrypt } from "@kody-ade/base/vault/crypto";
import { issueFlyHubEveTask } from "@dashboard/lib/fly-hub-eve-task";
import { setHubSession } from "@kody-ade/fly/hub/session";
const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  revoked: vi.fn(),
  eve: vi.fn(),
  inspect: vi.fn(),
}));
vi.mock("@kody-ade/fly/hub/app-cancellation", () => ({
  requestAppCancellation: mocks.cancel,
  isAppTaskCancelled: mocks.revoked,
}));
vi.mock("@dashboard/lib/eve-studio-client", () => ({
  callEveStudioTool: mocks.eve,
}));
vi.mock("@kody-ade/fly/hub/app-source", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  inspectPublicGitHubApp: mocks.inspect,
}));
const origin = "https://flyhub.example";
function request(path: string, body: unknown) {
  const cookie = NextResponse.json({});
  setHubSession(cookie, { token: "fake", orgSlug: "personal" });
  return new NextRequest(origin + path, {
    method: "POST",
    headers: {
      origin,
      host: "flyhub.example",
      "content-type": "application/json",
      cookie: cookie.cookies
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join("; "),
    },
    body: JSON.stringify(body),
  });
}
function task(token = "fake") {
  return issueFlyHubEveTask({
    token,
    orgSlug: "personal",
    repository: "acme/site",
    commitSha: "a".repeat(40),
  });
}
function handle(grant: string) {
  return encrypt(
    JSON.stringify({
      invocationId: "wrun_ABC123",
      agentId: "agent_builder",
      orgSlug: "personal",
      url: "https://github.com/acme/site",
      commitSha: "a".repeat(40),
      taskGrant: grant,
      startedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    }),
  );
}
beforeEach(() => {
  vi.stubEnv("KODY_MASTER_KEY", "33".repeat(32));
  vi.clearAllMocks();
  mocks.cancel.mockResolvedValue({
    status: "cancelling",
    workers: ["worker"],
    message: "Stopping setup",
  });
  mocks.revoked.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());
describe("whole deployment cancellation", () => {
  it("revokes Fly setup even if the external agent cannot be stopped", async () => {
    mocks.eve.mockRejectedValue(new Error("Eve unavailable"));
    const response = await cancelRun(
      request("/api/fly-hub/apps/agent", {
        action: "cancel",
        handle: handle(task()),
      }),
    );
    expect(response.status).toBe(202);
    expect(mocks.cancel).toHaveBeenCalledBefore(mocks.eve);
    expect(await response.json()).toMatchObject({
      status: "cancelling",
      agentWarning: expect.stringContaining("blocked"),
    });
  });
  it("rejects a handle owned by another token without cancelling anything", async () => {
    const response = await cancelRun(
      request("/api/fly-hub/apps/agent", {
        action: "cancel",
        handle: handle(task("other-token")),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.eve).not.toHaveBeenCalled();
  });
  it("rejects a late deployment before inspecting or building the repository", async () => {
    mocks.revoked.mockResolvedValue(true);
    const response = await deploy(
      request("/api/fly-hub/apps", {
        taskGrant: task(),
        taskBuild: { kind: "static", rootDirectory: ".", port: 8080 },
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("cancelled");
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
});
