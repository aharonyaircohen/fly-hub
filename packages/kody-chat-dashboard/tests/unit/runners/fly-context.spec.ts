import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const getRequestAuth = vi.fn();
const getUserOctokit = vi.fn();
const resolveActorFromToken = vi.fn();
const getEngineConfig = vi.fn();
const loadChatModels = vi.fn();
const readVault = vi.fn();

vi.mock("@kody-ade/base/auth", () => ({
  getRequestAuth: (...args: unknown[]) => getRequestAuth(...args),
  getUserOctokit: (...args: unknown[]) => getUserOctokit(...args),
  resolveActorFromToken: (...args: unknown[]) => resolveActorFromToken(...args),
}));

vi.mock("@kody-ade/base/engine/config", () => ({
  getEngineConfig: (...args: unknown[]) => getEngineConfig(...args),
}));

vi.mock("@kody-ade/base/variables/load-chat-models", () => ({
  loadAutomaticModel: vi
    .fn()
    .mockResolvedValue({ default: false, engineDefault: false }),
  loadChatModels: (...args: unknown[]) => loadChatModels(...args),
}));

vi.mock("@kody-ade/base/vault/store", () => ({
  readVault: (...args: unknown[]) => readVault(...args),
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { resolveFlyContext } from "@kody-ade/fly/plugin/runners/context";

function req(): NextRequest {
  return {
    headers: {
      get: () => null,
    },
  } as unknown as NextRequest;
}

function vault(secrets: Record<string, string>) {
  return {
    doc: {
      secrets: Object.fromEntries(
        Object.entries(secrets).map(([name, value]) => [name, { value }]),
      ),
    },
  };
}

beforeEach(() => {
  vi.stubEnv("FLY_API_TOKEN", "");
  vi.stubEnv("FLY_IO_TOKEN", "");
  vi.stubEnv("CONVEX_URL", "");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
  vi.stubEnv("KODY_SERVICE_KEY", "");
  getRequestAuth.mockReturnValue({
    token: "ghp_user",
    owner: "acme",
    repo: "widgets",
  });
  getUserOctokit.mockResolvedValue({ repos: {} });
  resolveActorFromToken.mockResolvedValue({ login: "alice" });
  getEngineConfig.mockResolvedValue({ config: { agent: { model: "m/x" } } });
  loadChatModels.mockResolvedValue([]);
  readVault.mockResolvedValue(
    vault({ FLY_API_TOKEN: "fly_vault", MINIMAX_API_KEY: "mini" }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("resolveFlyContext", () => {
  it("prefers the connected repo vault Fly token over server env", async () => {
    vi.stubEnv("FLY_API_TOKEN", "fly_server");

    const result = await resolveFlyContext(req());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.flyToken).toBe("fly_vault");
    expect(result.context.providerTokenSource).toBe("repo-vault");
    expect(result.context.allSecrets).toEqual({ MINIMAX_API_KEY: "mini" });
  });

  it("does not use the server Fly token when the repo vault has none", async () => {
    vi.stubEnv("FLY_API_TOKEN", "fly_server");
    readVault.mockResolvedValue(vault({ GEMINI_API_KEY: "gemini" }));

    const result = await resolveFlyContext(req());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.flyToken).toBeUndefined();
    expect(result.context.providerTokenSource).toBeNull();
    expect(result.context.allSecrets).toEqual({ GEMINI_API_KEY: "gemini" });
  });

  it("reports that no repo Fly token is configured", async () => {
    readVault.mockResolvedValue(vault({ GEMINI_API_KEY: "gemini" }));

    const result = await resolveFlyContext(req());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.flyToken).toBeUndefined();
    expect(result.context.providerTokenSource).toBeNull();
  });

  it("forwards canonical dashboard storage credentials to spawned runners", async () => {
    vi.stubEnv("CONVEX_URL", "https://canonical.convex.cloud");
    vi.stubEnv("KODY_SERVICE_KEY", "service-key");
    readVault.mockResolvedValue(
      vault({
        FLY_API_TOKEN: "fly_vault",
        MINIMAX_API_KEY: "mini",
        CONVEX_URL: "https://wrong.convex.cloud",
        KODY_SERVICE_KEY: "wrong-key",
      }),
    );

    const result = await resolveFlyContext(req());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.allSecrets).toEqual({
      MINIMAX_API_KEY: "mini",
      CONVEX_URL: "https://canonical.convex.cloud",
      KODY_SERVICE_KEY: "service-key",
    });
  });

  it("prefers the dashboard model registry for Brain model runtime config", async () => {
    loadChatModels.mockResolvedValue([
      {
        id: "minimax/MiniMax-M3",
        label: "MiniMax M3",
        provider: "custom",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M3",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
        engineDefault: true,
      },
    ]);

    const result = await resolveFlyContext(req());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.engineModel).toBe("minimax/MiniMax-M3");
    expect(result.context.engineModelConfig).toEqual({
      spec: "minimax/MiniMax-M3",
      provider: "custom",
      protocol: "openai",
      baseURL: "https://api.minimax.io/v1",
      modelName: "MiniMax-M3",
      apiKeyEnvVar: "MINIMAX_API_KEY",
    });
    expect(getEngineConfig).not.toHaveBeenCalled();
  });
});
