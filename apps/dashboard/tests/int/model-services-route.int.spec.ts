import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireKodyUser: vi.fn(),
  query: vi.fn(),
  getSession: vi.fn(),
  startSession: vi.fn(),
  writeInput: vi.fn(),
}));

vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: mocks.requireKodyUser,
}));
vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  backendApi: { userPreferences: { get: "userPreferences.get" } },
  getConvexClient: () => ({ query: mocks.query }),
}));
vi.mock("@kody-ade/terminal/local-chat-session", () => ({
  getLocalTerminalSessionInfoByChatSession: mocks.getSession,
  startLocalTerminalSession: mocks.startSession,
  writeLocalTerminalInput: mocks.writeInput,
}));

import { POST } from "../../app/api/kody/model-services/route";

const MODEL = {
  id: "custom/ornith",
  label: "Ornith Local",
  provider: "custom",
  adapter: "openai-compatible",
  adapterBaseURL: "http://127.0.0.1:8080/v1",
  protocol: "openai",
  baseURL: "http://127.0.0.1:8080/v1",
  modelName: "ornith",
  apiKeySecret: "ORNITH_LOCAL_API_KEY",
  service: {
    machine: "local",
    startCommand: "llama-server --port 8080",
    stopCommand: "pkill -INT -f llama-server",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireKodyUser.mockResolvedValue({ id: "user-1" });
  mocks.query.mockResolvedValue({ data: { models: [MODEL] } });
  mocks.startSession.mockResolvedValue({ sessionId: "session-1" });
  mocks.writeInput.mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => vi.unstubAllGlobals());

describe("personal model service route", () => {
  it("starts the saved local command for the signed-in account", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/kody/model-services", {
        method: "POST",
        body: JSON.stringify({ modelId: MODEL.id, action: "start" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.writeInput).toHaveBeenCalledWith(
      "session-1",
      { owner: "account-user-1", repo: "model-services" },
      MODEL.service.startCommand,
    );
  });

  it("rejects remote execution even for a signed-in account", async () => {
    const response = await POST(
      new NextRequest("https://dashboard.example/api/kody/model-services", {
        method: "POST",
        body: JSON.stringify({ modelId: MODEL.id, action: "start" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("reports readiness from the model health endpoint", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/kody/model-services", {
        method: "POST",
        body: JSON.stringify({ modelId: MODEL.id, action: "status" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ready" });
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8080/health"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("requires the Kody account session", async () => {
    mocks.requireKodyUser.mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const response = await POST(
      new NextRequest("http://localhost/api/kody/model-services", {
        method: "POST",
        body: JSON.stringify({ modelId: MODEL.id, action: "start" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
