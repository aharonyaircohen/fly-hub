import { beforeEach, describe, expect, it, vi } from "vitest";

const updateVariablesMock = vi.hoisted(() => vi.fn());
const getEngineConfigMock = vi.hoisted(() => vi.fn());
const writeEngineModelSelectionMock = vi.hoisted(() => vi.fn());

vi.mock("../src/variables/store", () => ({
  updateVariables: updateVariablesMock,
}));
vi.mock("../src/engine/config", () => ({
  getEngineConfig: getEngineConfigMock,
  writeEngineModelSelection: writeEngineModelSelectionMock,
}));

import {
  saveManagedChatModels,
  upsertVariable,
} from "../src/variables/mutations";

const EMPTY_DOC = { version: 1 as const, variables: {} };

describe("shared variable mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateVariablesMock.mockImplementation(async (_owner, _repo, mutate) => ({
      doc: mutate(EMPTY_DOC),
    }));
    getEngineConfigMock.mockResolvedValue({ config: {}, sha: null });
    writeEngineModelSelectionMock.mockResolvedValue({ sha: "commit" });
  });

  it("upserts variables with the verified actor metadata", async () => {
    const result = await upsertVariable({
      owner: "acme",
      repo: "app",
      name: "FEATURE_FLAG",
      value: "on",
      actorLogin: "alice",
      now: "2026-08-05T00:00:00.000Z",
    });

    expect(result.doc.variables.FEATURE_FLAG).toEqual({
      value: "on",
      updatedAt: "2026-08-05T00:00:00.000Z",
      updatedBy: "alice",
    });
  });

  it("saves models and synchronizes the engine default", async () => {
    const models = [
      {
        id: "openrouter/free",
        label: "OpenRouter Free",
        provider: "openrouter" as const,
        protocol: "openai" as const,
        baseURL: "https://openrouter.ai/api/v1",
        modelName: "openrouter/free",
        apiKeySecret: "OPENROUTER_API_KEY",
        enabled: true,
        engineDefault: true,
      },
    ];

    const result = await saveManagedChatModels({
      octokit: {} as never,
      owner: "acme",
      repo: "app",
      models,
      actorLogin: "alice",
      now: "2026-08-05T00:00:00.000Z",
    });

    expect(result.engineSyncWarning).toBeUndefined();
    expect(writeEngineModelSelectionMock).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "app",
      {
        modelSpec: "openrouter/free",
        modelConfig: {
          spec: "openrouter/free",
          provider: "openrouter",
          protocol: "openai",
          baseURL: "https://openrouter.ai/api/v1",
          modelName: "openrouter/free",
          apiKeyEnvVar: "OPENROUTER_API_KEY",
        },
        automaticModels: [],
      },
    );
  });

  it("selects Automatic for Engine without changing the chat default", async () => {
    const models = [
      {
        id: "anthropic/claude-a",
        label: "Claude A",
        provider: "anthropic" as const,
        protocol: "anthropic" as const,
        baseURL: "https://api.anthropic.com/v1",
        modelName: "claude-a",
        apiKeySecret: "ANTHROPIC_API_KEY",
        enabled: true,
        automatic: true,
        default: true,
      },
      {
        id: "openai/gpt-b",
        label: "GPT B",
        provider: "openai" as const,
        protocol: "openai" as const,
        baseURL: "https://api.openai.com/v1",
        modelName: "gpt-b",
        apiKeySecret: "OPENAI_API_KEY",
        enabled: true,
        automatic: true,
      },
    ];

    await saveManagedChatModels({
      octokit: {} as never,
      owner: "acme",
      repo: "app",
      models,
      automatic: { engineDefault: true },
    });

    expect(models[0].default).toBe(true);
    expect(writeEngineModelSelectionMock).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "app",
      expect.objectContaining({
        modelSpec: "automatic",
        automaticModels: [
          expect.objectContaining({ spec: "anthropic/claude-a" }),
          expect.objectContaining({ spec: "openai/gpt-b" }),
        ],
      }),
    );
  });

  it("allows Automatic as the Chat default without changing the Engine default", async () => {
    const models = [
      {
        id: "anthropic/claude-a",
        label: "Claude A",
        provider: "anthropic" as const,
        protocol: "anthropic" as const,
        baseURL: "https://api.anthropic.com/v1",
        modelName: "claude-a",
        apiKeySecret: "ANTHROPIC_API_KEY",
        enabled: true,
        automatic: true,
        engineDefault: true,
      },
      {
        id: "openai/gpt-b",
        label: "GPT B",
        provider: "openai" as const,
        protocol: "openai" as const,
        baseURL: "https://api.openai.com/v1",
        modelName: "gpt-b",
        apiKeySecret: "OPENAI_API_KEY",
        enabled: true,
        automatic: true,
      },
    ];

    await saveManagedChatModels({
      octokit: {} as never,
      owner: "acme",
      repo: "app",
      models,
      automatic: { default: true, engineDefault: false },
    });

    expect(models[0].engineDefault).toBe(true);
  });
});
