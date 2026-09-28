import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getRequestAuth: vi.fn<
    () => { owner: string; repo: string; token: string } | null
  >(() => ({
    owner: "acme",
    repo: "widgets",
    token: "secret-token",
  })),
}));
const install = vi.hoisted(() => ({ installEngine: vi.fn() }));
const personalModels = vi.hoisted(() => ({
  readPersonalCredential: vi.fn(),
  readPersonalModelSettings: vi.fn(),
}));
const chat = vi.hoisted(() => ({
  resolveChatModel: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@dashboard/lib/github-client", () => ({
  createUserOctokit: vi.fn(() => ({ mocked: true })),
}));
vi.mock("@dashboard/lib/engine/install", () => install);
vi.mock("@dashboard/lib/chat/personal-model-settings", () => personalModels);
vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: vi.fn(async () => ({ id: "user-1", label: "Alice" })),
}));
vi.mock("@kody-ade/base/auth/oauth-url", () => ({
  getPublicBaseUrl: vi.fn(() => "https://dashboard.test"),
}));
vi.mock("../../../app/api/kody/chat/resolve-model", () => ({
  resolveChatModel: chat.resolveChatModel,
}));
vi.mock("ai", () => ({
  generateText: chat.generateText,
  tool: (definition: unknown) => definition,
}));

import { POST } from "../../../app/api/kody/chat/operations/route";

function request(
  input: string,
  context?: Record<string, unknown>,
): NextRequest {
  return new NextRequest("https://dashboard.test/api/kody/chat/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, ...(context ? { context } : {}) }),
  });
}

describe("Chat operations route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personalModels.readPersonalModelSettings.mockResolvedValue({
      models: [
        {
          id: "minimax/MiniMax-M3",
          label: "MiniMax M3",
          apiKeySecret: "MINIMAX_API_KEY",
        },
      ],
    });
    install.installEngine.mockResolvedValue({
      ok: true,
      summary: "Kody Engine is ready.",
    });
    chat.resolveChatModel.mockResolvedValue({
      model: { modelId: "openrouter/free" },
      resolvedModel: { id: "openrouter/free", label: "OpenRouter Free" },
      apiKey: "secret",
    });
    chat.generateText.mockResolvedValue({
      toolCalls: [{ toolName: "kody_readiness_check", input: { ready: true } }],
    });
  });

  it("executes /init through the registered operation", async () => {
    const response = await POST(request("/init --force"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      handled: true,
      command: "/init",
      result: { status: "completed", summary: "Kody Engine is ready." },
    });
    expect(install.installEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        token: "secret-token",
        force: true,
        resolvePersonalSecret: personalModels.readPersonalCredential,
        personalModels: [
          expect.objectContaining({ apiKeySecret: "MINIMAX_API_KEY" }),
        ],
      }),
    );
  });

  it("marks a partial /init result as needing attention", async () => {
    install.installEngine.mockResolvedValueOnce({
      ok: true,
      summary: "Engine installed. Webhook FAILED — Not Found (HTTP 404).",
      webhook: { ok: false, status: 404, error: "Not Found" },
      kodyTokenSecret: { ok: true, name: "KODY_TOKEN" },
      nextSteps: ["Grant webhook permission, then re-run /init."],
    });

    const response = await POST(request("/init"));

    await expect(response.json()).resolves.toMatchObject({
      handled: true,
      result: {
        status: "needs_attention",
        summary: "Engine installed. Webhook FAILED — Not Found (HTTP 404).",
      },
    });
  });

  it("leaves prompt shortcuts unhandled", async () => {
    const response = await POST(request("/review"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ handled: false });
    expect(install.installEngine).not.toHaveBeenCalled();
  });

  it("requires repository authentication for executable operations", async () => {
    auth.getRequestAuth.mockReturnValueOnce(null);

    const response = await POST(request("/init"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "missing_auth",
    });
  });

  it("rejects unsupported /init arguments", async () => {
    const response = await POST(request("/init --unknown"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_command_arguments",
    });
    expect(install.installEngine).not.toHaveBeenCalled();
  });

  it("verifies the exact chat model with a required tool call", async () => {
    const response = await POST(request("/check-chat openrouter/free"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      handled: true,
      result: { status: "completed", summary: "OpenRouter Free is ready." },
    });
    expect(chat.resolveChatModel).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "openrouter/free",
    );
    expect(chat.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        toolChoice: "auto",
      }),
    );
  });

  it("runs a workflow with the values collected by a Guided Flow", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, runId: "run-123" }, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request("/run-workflow custom-workflow", {
        flowData: {
          resourceId: "resource-1",
          assetPath: "input.bin",
          stepResults: { ignored: true },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      handled: true,
      command: "/run-workflow",
      result: {
        status: "completed",
        runId: "run-123",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "https://dashboard.test/api/kody/company/workflows/custom-workflow/run",
      ),
      expect.objectContaining({
        body: JSON.stringify({
          input: {
            resourceId: "resource-1",
            assetPath: "input.bin",
          },
        }),
      }),
    );
  });

  it("approves and starts a workflow from its Guided Flow challenge", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ approvalId: "approval-1" }, { status: 201 }),
      )
      .mockResolvedValueOnce(
        Response.json({ ok: true, runId: "run-456" }, { status: 202 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request("/run-workflow custom-workflow", {
        actionId: "approve",
        flowData: {
          resourceId: "resource-1",
          assetPath: "input.bin",
          status: "needs_attention",
          summary: "Approve this workflow.",
          approvalChallenge: "signed-challenge",
        },
        previousResult: {
          approvalChallenge: "signed-challenge",
          workflowInput: {
            resourceId: "resource-1",
            assetPath: "input.bin",
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      handled: true,
      result: { status: "completed", runId: "run-456" },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      new URL(
        "https://dashboard.test/api/kody/company/workflows/custom-workflow/approve",
      ),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          approvalToken: "signed-challenge",
          input: { resourceId: "resource-1", assetPath: "input.bin" },
        }),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          input: { resourceId: "resource-1", assetPath: "input.bin" },
          approvalId: "approval-1",
        }),
      }),
    );
  });

  it("keeps the original workflow input with its approval challenge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "approval_required",
            approvalToken: "signed-challenge",
          },
          { status: 409 },
        ),
      ),
    );

    const response = await POST(
      request("/run-workflow custom-workflow", {
        flowData: { resourceId: "resource-1", assetPath: "input.bin" },
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      result: {
        status: "needs_attention",
        workflowId: "custom-workflow",
        approvalChallenge: "signed-challenge",
        workflowInput: { resourceId: "resource-1", assetPath: "input.bin" },
      },
    });
  });

  it("keeps onboarding blocked when the provider cannot route tool calls", async () => {
    chat.generateText.mockRejectedValueOnce(
      Object.assign(new Error("Provider returned error"), {
        responseBody:
          "No allowed providers are available for the selected model, but your account's allowed-providers setting permits only: openai.",
      }),
    );

    const response = await POST(request("/check-chat openrouter/free"));

    await expect(response.json()).resolves.toMatchObject({
      handled: true,
      result: {
        status: "needs_attention",
        summary: expect.stringContaining("OpenRouter Privacy settings"),
      },
    });
  });
});
