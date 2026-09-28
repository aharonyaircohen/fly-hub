import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  service: vi.fn(),
  start: vi.fn(),
  bridge: vi.fn(),
  mint: vi.fn(() => "encrypted-ticket"),
  repoContext: vi.fn(),
}));
vi.mock("@kody-ade/brain/personal-context", () => ({
  resolvePersonalBrainContext: mocks.context,
}));
vi.mock("@kody-ade/brain/service-resolver", () => ({
  resolveBrainService: mocks.service,
}));
vi.mock("@kody-ade/fly/infrastructure/server-context", async (original) => ({
  ...(await original<object>()),
  resolveServerProviderContext: mocks.repoContext,
}));
vi.mock("@kody-ade/fly/infrastructure/server-machines", async (original) => ({
  ...(await original<object>()),
  startServerProviderMachine: mocks.start,
}));
vi.mock("@kody-ade/fly/infrastructure/server-terminal", () => ({
  ensureServerProviderTerminalBridge: mocks.bridge,
}));
vi.mock("@kody-ade/terminal/terminal-token", () => ({
  mintTerminalBridgeToken: mocks.mint,
}));

import { POST } from "../../app/api/kody/terminal/session/route";

const machine = {
  feature: "brain",
  app: "personal-brain-app",
  machineId: "new-machine",
  state: "started",
  region: "fra",
  label: "Personal Brain",
  orgSlug: "my-org",
};
const service = {
  app: machine.app,
  orgSlug: "my-org",
  defaultRegion: "fra",
  flyToken: "personal-only-token",
  machine,
};
function request(body: unknown = { target: "brain", chatSessionId: "chat-1" }) {
  return new NextRequest("http://localhost:3333/api/kody/terminal/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("personal Brain terminal route", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({
      ok: true,
      context: {
        userId: "user-1",
        account: "user-stable-id",
        githubToken: "",
        allSecrets: {},
        flyToken: "personal-only-token",
        flyOrgSlug: "my-org",
        flyDefaultRegion: "fra",
      },
    });
    mocks.service.mockResolvedValue(service);
    mocks.repoContext.mockResolvedValue({
      ok: false,
      status: 400,
      error: "Repository context is not available",
    });
    mocks.bridge.mockResolvedValue({
      url: "https://terminal.example.test",
      app: "gateway",
      secret: "gateway-secret",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
  });

  it("connects the newly created personal Brain without repository credentials", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.machineId).toBe("new-machine");
    expect(body.session.scope).toMatchObject({
      owner: "user-stable-id",
      repo: "personal-brain",
      conversationId: "chat-1",
    });
    expect(mocks.repoContext).not.toHaveBeenCalled();
    expect(mocks.mint).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "personal-only-token",
        machineId: "new-machine",
        workspace: "machine",
      }),
    );
    expect(JSON.stringify(body)).not.toContain("personal-only-token");
  });

  it("uses the current personal Brain instead of a stale or foreign machine selection", async () => {
    const response = await POST(
      request({
        app: "foreign-app",
        machineId: "old-machine",
        feature: "brain",
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).machineId).toBe("new-machine");
    expect(mocks.service).toHaveBeenCalledWith(
      expect.not.objectContaining({ appNameOverride: "foreign-app" }),
    );
  });

  it("wakes the selected personal Brain before returning its terminal", async () => {
    mocks.service.mockResolvedValueOnce({
      ...service,
      machine: { ...machine, state: "stopped" },
    });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.start).toHaveBeenCalledWith(
      "personal-brain-app",
      "new-machine",
      expect.objectContaining({ token: "personal-only-token" }),
    );
  });

  it("requires a signed-in personal account", async () => {
    mocks.context.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it("reports the missing personal Fly token explicitly", async () => {
    mocks.context.mockResolvedValue({
      ok: true,
      context: { userId: "user-1" },
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("fly_token_missing");
    expect(mocks.service).not.toHaveBeenCalled();
  });
});
