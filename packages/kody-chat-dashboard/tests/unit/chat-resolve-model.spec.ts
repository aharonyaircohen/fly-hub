import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getRequestAuth, getUserOctokit } from "@kody-ade/base/auth";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import { getSecret } from "@kody-ade/base/vault/get-secret";
import {
  loadAutomaticModel,
  loadChatModels,
} from "@kody-ade/base/variables/load-chat-models";
import { resolveChatModel } from "../../app/api/kody/chat/resolve-model";
import { loadOpenCodeFreeModels } from "../../app/api/kody/chat/opencode-free";
vi.mock("../../app/api/kody/chat/opencode-free", () => ({
  loadOpenCodeFreeModels: vi.fn(),
}));
import { setChatModelSettingsProvider } from "../../app/api/kody/chat/model-settings-provider";

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn((modelName: string) => ({ modelName }))),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() =>
    vi.fn((modelName: string) => ({ modelName })),
  ),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() =>
    vi.fn((modelName: string) => ({ modelName })),
  ),
}));

vi.mock("@kody-ade/base/auth", () => ({
  getRequestAuth: vi.fn(),
  getUserOctokit: vi.fn(),
}));

vi.mock("@kody-ade/base/engine/config", () => ({
  getEngineConfig: vi.fn(),
}));

vi.mock("@kody-ade/base/vault/get-secret", () => ({
  getSecret: vi.fn(),
}));

vi.mock("@kody-ade/base/variables/load-chat-models", () => ({
  loadAutomaticModel: vi.fn(),
  loadChatModels: vi.fn(),
}));

function request(): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/kody", {
    headers: {
      "x-kody-token": "ghp_test",
      "x-kody-owner": "owner",
      "x-kody-repo": "repo",
    },
  });
}

describe("resolveChatModel", () => {
  it("automatically falls back within the current free catalog without credentials", async () => {
    vi.mocked(loadOpenCodeFreeModels).mockResolvedValue([
      { id: "limited", label: "Limited", adapter: "openai-compatible" },
      { id: "ready", label: "Ready", adapter: "openai-compatible" },
    ]);
    const calls: string[] = [];
    vi.mocked(createOpenAICompatible).mockImplementation(
      () =>
        ((modelId: string) => ({
          specificationVersion: "v3",
          provider: "test",
          modelId,
          supportedUrls: {},
          doGenerate: async () => {
            calls.push(modelId);
            if (modelId === "limited")
              throw Object.assign(new Error("Rate limited"), {
                statusCode: 429,
              });
            return { content: [{ type: "text", text: "OK" }] };
          },
        })) as never,
    );
    const onAutomaticFallback = vi.fn();
    const result = await resolveChatModel(request(), "opencode-free", {
      onAutomaticFallback,
    });
    expect(result).not.toHaveProperty("error");
    if ("error" in result) return;
    expect(result.resolvedModel.label).toBe("OpenCode Free");
    await (
      result.model as import("@ai-sdk/provider").LanguageModelV3
    ).doGenerate({ prompt: [] });
    expect(calls).toEqual(["limited", "ready"]);
    expect(onAutomaticFallback).toHaveBeenCalledWith({
      from: "Limited",
      to: "Ready",
      reason: "rate_limit",
    });
    expect(getSecret).not.toHaveBeenCalled();
  });
  it("supports a free catalog with only one remaining model", async () => {
    vi.mocked(loadOpenCodeFreeModels).mockResolvedValue([
      { id: "only", label: "Only", adapter: "openai-compatible" },
    ]);
    expect(
      await resolveChatModel(request(), "opencode-free"),
    ).not.toHaveProperty("error");
  });
  it("reports when there are no free models instead of choosing a paid model", async () => {
    vi.mocked(loadOpenCodeFreeModels).mockResolvedValue([]);
    const result = await resolveChatModel(request(), "opencode-free");
    expect(result).toHaveProperty("error");
    if ("error" in result)
      expect(await result.error.json()).toMatchObject({
        error: "model_unavailable",
      });
    expect(getSecret).not.toHaveBeenCalled();
  });
  it("resolves a discovered picker model without saving it in settings", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([]);
    vi.mocked(loadOpenCodeFreeModels).mockResolvedValue([
      { id: "new-free", label: "New Free", adapter: "openai-compatible" },
    ]);
    const result = await resolveChatModel(request(), "opencode-free/new-free");
    expect(result).not.toHaveProperty("error");
    if (!("error" in result))
      expect(result.resolvedModel.modelName).toBe("new-free");
    expect(getSecret).not.toHaveBeenCalled();
  });
  const freeModel = {
    id: "opencode-free/test",
    label: "Free test",
    provider: "opencode-free" as const,
    protocol: "openai" as const,
    baseURL: "https://opencode.ai/zen/v1",
    modelName: "test",
    apiKeySecret: "",
    enabled: true,
  };
  it("resolves anonymous free models without reading any credentials", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([freeModel]);
    vi.mocked(loadOpenCodeFreeModels).mockResolvedValue([
      { id: "test", label: "Test", adapter: "openai-compatible" },
    ]);
    const result = await resolveChatModel(request(), freeModel.id);
    expect(result).not.toHaveProperty("error");
    expect(getSecret).not.toHaveBeenCalled();
    expect(createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: undefined,
        baseURL: "https://opencode.ai/zen/v1",
      }),
    );
  });
  it("reports withdrawn models instead of silently using the default", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([freeModel]);
    vi.mocked(loadOpenCodeFreeModels).mockResolvedValue([]);
    const result = await resolveChatModel(request(), freeModel.id);
    expect(result).toHaveProperty("error");
    if ("error" in result)
      expect(await result.error.json()).toMatchObject({
        error: "model_unavailable",
      });
    expect(getSecret).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(loadChatModels).mockResolvedValue([]);
    vi.mocked(loadAutomaticModel).mockResolvedValue({
      default: false,
      engineDefault: false,
    });
    vi.mocked(getRequestAuth).mockReturnValue({
      owner: "owner",
      repo: "repo",
      token: "ghp_test",
    });
    vi.mocked(getUserOctokit).mockResolvedValue({} as never);
    vi.mocked(getSecret).mockResolvedValue("provider-key");
    setChatModelSettingsProvider(null);
  });

  it("uses host-owned personal settings without repository access", async () => {
    vi.mocked(getRequestAuth).mockReturnValue(null);
    setChatModelSettingsProvider({
      load: vi.fn(async () => ({
        models: [
          {
            id: "minimax/MiniMax-M3",
            label: "Personal MiniMax",
            provider: "minimax" as const,
            protocol: "openai" as const,
            baseURL: "https://api.minimax.io/v1",
            modelName: "MiniMax-M3",
            apiKeySecret: "MINIMAX_API_KEY",
            enabled: true,
            default: true,
          },
        ],
        automatic: { default: false, engineDefault: false },
      })),
      getCredential: vi.fn(async () => "personal-provider-key"),
    });

    const result = await resolveChatModel(
      new NextRequest("https://dash.test/api/kody/chat/kody"),
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel.label).toBe("Personal MiniMax");
    expect(loadChatModels).not.toHaveBeenCalled();
    expect(getSecret).not.toHaveBeenCalled();
    expect(createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "personal-provider-key" }),
    );
  });

  it("prefers a repository model credential over the personal credential", async () => {
    vi.mocked(getSecret).mockImplementation(async (_name, options) =>
      options.vaultOnly ? "repository-provider-key" : "environment-key",
    );
    const personalCredential = vi.fn(async () => "personal-provider-key");
    setChatModelSettingsProvider({
      load: vi.fn(async () => ({
        models: [
          {
            id: "minimax/MiniMax-M3",
            label: "Personal MiniMax",
            provider: "minimax" as const,
            protocol: "openai" as const,
            baseURL: "https://api.minimax.io/v1",
            modelName: "MiniMax-M3",
            apiKeySecret: "MINIMAX_API_KEY",
            enabled: true,
            default: true,
          },
        ],
        automatic: { default: false, engineDefault: false },
      })),
      getCredential: personalCredential,
    });

    const result = await resolveChatModel(request());

    expect("error" in result).toBe(false);
    expect(personalCredential).not.toHaveBeenCalled();
    expect(createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "repository-provider-key" }),
    );
  });

  it("never falls back to a personal credential for a repo model", async () => {
    vi.mocked(getSecret).mockResolvedValue(null);
    const personalCredential = vi.fn(async () => "personal-provider-key");
    setChatModelSettingsProvider({
      load: vi.fn(async () => ({
        models: [
          {
            id: "repo::minimax/MiniMax-M3",
            label: "Repo MiniMax",
            provider: "minimax" as const,
            protocol: "openai" as const,
            baseURL: "https://api.minimax.io/v1",
            modelName: "MiniMax-M3",
            apiKeySecret: "MINIMAX_API_KEY",
            enabled: true,
            default: true,
          },
        ],
        automatic: { default: false, engineDefault: false },
      })),
      getCredential: personalCredential,
    });

    const result = await resolveChatModel(
      request(),
      "repo::minimax/MiniMax-M3",
    );

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error.status).toBe(409);
    await expect(result.error.json()).resolves.toMatchObject({
      error: "model_api_key_missing",
    });
    expect(personalCredential).not.toHaveBeenCalled();
  });

  it("uses the embedded OpenRouter model when LLM_MODELS is empty", async () => {
    vi.mocked(getEngineConfig).mockResolvedValue({
      sha: "abc123",
      config: {
        defaultImplementation: "run",
        agent: { model: "minimax/MiniMax-M3" },
      },
    });

    const result = await resolveChatModel(request());

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel).toMatchObject({
      id: "openrouter/free",
      provider: "openrouter",
      protocol: "openai",
      baseURL: "https://openrouter.ai/api/v1",
      modelName: "openrouter/free",
      apiKeySecret: "OPENROUTER_API_KEY",
    });
    expect(getSecret).toHaveBeenCalledWith("OPENROUTER_API_KEY", {
      req: expect.any(NextRequest),
      vaultOnly: true,
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "openrouter",
        apiKey: "provider-key",
        baseURL: "https://openrouter.ai/api/v1",
        transformRequestBody: expect.any(Function),
      }),
    );
  });

  it("requires the configured Ox Alpha API key", async () => {
    vi.mocked(getSecret).mockResolvedValue("ox-alpha-key");

    const result = await resolveChatModel(request(), "openai/ox-alpha");

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel).toMatchObject({
      id: "openai/ox-alpha",
      label: "Ox Alpha",
      provider: "custom",
      modelName: "ox-alpha",
    });
    expect(result.apiKey).toBe("ox-alpha-key");
    expect(getSecret).toHaveBeenCalledWith("OXALPHA_API_KEY", {
      req: expect.any(NextRequest),
      vaultOnly: true,
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "custom",
        apiKey: "ox-alpha-key",
        baseURL: "https://oxalpha.run/api/v1",
      }),
    );
  });

  it("uses Automatic when it is the saved Chat default", async () => {
    vi.mocked(loadAutomaticModel).mockResolvedValue({
      default: true,
      engineDefault: false,
    });
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "model-a",
        label: "Model A",
        provider: "openai",
        protocol: "openai",
        baseURL: "https://a.test/v1",
        modelName: "model-a",
        apiKeySecret: "MODEL_A_KEY",
        enabled: true,
        automatic: true,
      },
      {
        id: "model-b",
        label: "Model B",
        provider: "openai",
        protocol: "openai",
        baseURL: "https://b.test/v1",
        modelName: "model-b",
        apiKeySecret: "MODEL_B_KEY",
        enabled: true,
        automatic: true,
      },
    ]);

    const result = await resolveChatModel(request());

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel.id).toBe("automatic");
  });

  it("skips unavailable Automatic candidates and keeps configured models in order", async () => {
    vi.mocked(loadAutomaticModel).mockResolvedValue({
      default: true,
      engineDefault: false,
    });
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "missing-model",
        label: "Missing model",
        provider: "openai",
        protocol: "openai",
        baseURL: "https://missing.test/v1",
        modelName: "missing-model",
        apiKeySecret: "MISSING_KEY",
        enabled: true,
        automatic: true,
      },
      {
        id: "model-a",
        label: "Model A",
        provider: "openai",
        protocol: "openai",
        baseURL: "https://a.test/v1",
        modelName: "model-a",
        apiKeySecret: "MODEL_A_KEY",
        enabled: true,
        automatic: true,
      },
      {
        id: "model-b",
        label: "Model B",
        provider: "openai",
        protocol: "openai",
        baseURL: "https://b.test/v1",
        modelName: "model-b",
        apiKeySecret: "MODEL_B_KEY",
        enabled: true,
        automatic: true,
      },
    ]);
    vi.mocked(getSecret).mockImplementation(async (name) =>
      name === "MISSING_KEY" ? null : `${name}-value`,
    );

    const result = await resolveChatModel(request());

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel.id).toBe("automatic");
    expect(createOpenAICompatible).toHaveBeenCalledTimes(2);
    expect(createOpenAICompatible).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ apiKey: "MODEL_A_KEY-value" }),
    );
    expect(createOpenAICompatible).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ apiKey: "MODEL_B_KEY-value" }),
    );
  });

  it("rejects Automatic when only one selected candidate is runnable", async () => {
    vi.mocked(loadAutomaticModel).mockResolvedValue({
      default: true,
      engineDefault: false,
    });
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "missing-model",
        label: "Missing model",
        provider: "openai",
        protocol: "openai",
        baseURL: "https://missing.test/v1",
        modelName: "missing-model",
        apiKeySecret: "MISSING_KEY",
        enabled: true,
        automatic: true,
      },
      {
        id: "model-a",
        label: "Model A",
        provider: "openai",
        protocol: "openai",
        baseURL: "https://a.test/v1",
        modelName: "model-a",
        apiKeySecret: "MODEL_A_KEY",
        enabled: true,
        automatic: true,
      },
    ]);
    vi.mocked(getSecret).mockImplementation(async (name) =>
      name === "MODEL_A_KEY" ? "model-a-key" : null,
    );

    const result = await resolveChatModel(request());

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error.status).toBe(409);
    await expect(result.error.json()).resolves.toMatchObject({
      error: "automatic_requires_configured_models",
    });
    expect(createOpenAICompatible).toHaveBeenCalledTimes(1);
  });

  it("keeps MiniMax M3 for ordinary text turns", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "minimax/MiniMax-M3",
        label: "MiniMax M3",
        provider: "minimax",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M3",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
        default: true,
      },
    ]);

    const result = await resolveChatModel(request(), "minimax/MiniMax-M3", {
      preferVision: false,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel.modelName).toBe("MiniMax-M3");
    expect(result.model).toMatchObject({ modelName: "MiniMax-M3" });
    expect(createGoogleGenerativeAI).not.toHaveBeenCalled();
  });

  it("routes every Google model through the native Google adapter", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "google/client-added-model",
        label: "Client-added Google model",
        provider: "google",
        adapter: "google",
        adapterBaseURL: "https://generativelanguage.googleapis.com/v1beta",
        protocol: "openai",
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
        modelName: "client-added-model",
        apiKeySecret: "GEMINI_API_KEY",
        enabled: true,
        default: true,
      },
    ]);

    const result = await resolveChatModel(
      request(),
      "google/client-added-model",
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.model).toMatchObject({ modelName: "client-added-model" });
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: "provider-key",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
    });
    expect(createOpenAICompatible).not.toHaveBeenCalled();
  });

  it("rejects an embedding model with a clear chat-model error", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "openrouter/nemotron-3-embed-1b:free",
        label: "OpenRouter Nemotron embedding",
        provider: "openrouter",
        protocol: "openai",
        baseURL: "https://openrouter.ai/api/v1",
        modelName: "nemotron-3-embed-1b:free",
        apiKeySecret: "OPENROUTER_API_KEY",
        enabled: true,
        default: true,
      },
    ]);

    const result = await resolveChatModel(
      request(),
      "openrouter/nemotron-3-embed-1b:free",
    );

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error.status).toBe(409);
    await expect(result.error.json()).resolves.toMatchObject({
      error: "model_not_chat_capable",
    });
  });

  it("uses MiniMax M3 for image turns when MiniMax M2 is selected", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "minimax/MiniMax-M2",
        label: "MiniMax M2",
        provider: "minimax",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M2",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
        default: true,
      },
    ]);

    const result = await resolveChatModel(request(), "minimax/MiniMax-M2", {
      preferVision: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel).toMatchObject({
      id: "minimax/MiniMax-M3",
      provider: "minimax",
      modelName: "MiniMax-M3",
      apiKeySecret: "MINIMAX_API_KEY",
    });
    expect(result.model).toMatchObject({ modelName: "MiniMax-M3" });
  });

  it("uses MiniMax M3 for image turns when the MiniMax entry is a custom endpoint", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "minimax/MiniMax-M2",
        label: "MiniMax",
        provider: "custom",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M2",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
        default: true,
      },
    ]);

    const result = await resolveChatModel(request(), "minimax/MiniMax-M2", {
      preferVision: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel).toMatchObject({
      id: "minimax/MiniMax-M3",
      provider: "custom",
      baseURL: "https://api.minimax.io/v1",
      modelName: "MiniMax-M3",
      apiKeySecret: "MINIMAX_API_KEY",
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "custom",
        apiKey: "provider-key",
        baseURL: "https://api.minimax.io/v1",
        transformRequestBody: expect.any(Function),
      }),
    );
  });

  it("prefers a configured MiniMax vision sibling for image turns", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "minimax/MiniMax-M2",
        label: "MiniMax M2",
        provider: "minimax",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M2",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
        default: true,
      },
      {
        id: "minimax/MiniMax-M3",
        label: "MiniMax M3",
        provider: "minimax",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M3",
        apiKeySecret: "MINIMAX_M3_API_KEY",
        enabled: true,
      },
    ]);

    const result = await resolveChatModel(request(), "minimax/MiniMax-M2", {
      preferVision: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel).toMatchObject({
      id: "minimax/MiniMax-M3",
      modelName: "MiniMax-M3",
      apiKeySecret: "MINIMAX_M3_API_KEY",
    });
    expect(getSecret).toHaveBeenCalledWith("MINIMAX_M3_API_KEY", {
      req: expect.any(NextRequest),
      vaultOnly: true,
    });
  });

  it("prefers a configured custom MiniMax M3 sibling for image turns", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "minimax/MiniMax-M2",
        label: "MiniMax",
        provider: "custom",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M2",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
        default: true,
      },
      {
        id: "minimax/MiniMax-M3",
        label: "MiniMax M3",
        provider: "custom",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M3",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
      },
    ]);

    const result = await resolveChatModel(request(), "minimax/MiniMax-M2", {
      preferVision: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel).toMatchObject({
      id: "minimax/MiniMax-M3",
      provider: "custom",
      modelName: "MiniMax-M3",
      apiKeySecret: "MINIMAX_API_KEY",
    });
  });
});
