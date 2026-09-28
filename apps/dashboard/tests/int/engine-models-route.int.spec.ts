import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  getRequestAuth: vi.fn(),
  getUserOctokit: vi.fn(),
  verifyActorLogin: vi.fn(),
  readVariables: vi.fn(),
  readManagedChatModels: vi.fn(),
  readManagedAutomaticModel: vi.fn(),
  saveManagedChatModels: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: mocks.requireKodyAuth,
  getRequestAuth: mocks.getRequestAuth,
  getUserOctokit: mocks.getUserOctokit,
  verifyActorLogin: mocks.verifyActorLogin,
}));

vi.mock("@kody-ade/base/variables/store", () => ({
  readVariables: mocks.readVariables,
}));

vi.mock("@kody-ade/base/variables/mutations", async () => {
  const actual = await vi.importActual<typeof import("@kody-ade/base/variables/mutations")>(
    "@kody-ade/base/variables/mutations",
  );
  return {
    ...actual,
    readManagedChatModels: mocks.readManagedChatModels,
    readManagedAutomaticModel: mocks.readManagedAutomaticModel,
    saveManagedChatModels: mocks.saveManagedChatModels,
  };
});

import { GET, PUT } from "../../app/api/kody/engine-models/route";

const AUTH = { owner: "test-owner", repo: "test-repo" };
const MODEL = {
  id: "openrouter/free",
  label: "OpenRouter Free",
  provider: "openrouter",
  adapter: "openai-compatible",
  protocol: "openai",
  baseURL: "https://openrouter.ai/api/v1",
  modelName: "openrouter/free",
  apiKeySecret: "OPENROUTER_API_KEY",
  enabled: true,
  automatic: true,
  default: false,
  engineDefault: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireKodyAuth.mockResolvedValue(undefined);
  mocks.getRequestAuth.mockReturnValue(AUTH);
  mocks.getUserOctokit.mockResolvedValue({});
  mocks.verifyActorLogin.mockResolvedValue({
    identity: { login: "test-user" },
  });
  mocks.readVariables.mockResolvedValue({ doc: { variables: {} } });
  mocks.readManagedChatModels.mockReturnValue([MODEL]);
  mocks.readManagedAutomaticModel.mockReturnValue({
    default: false,
    engineDefault: true,
  });
  mocks.saveManagedChatModels.mockResolvedValue({ models: [MODEL] });
});

describe("repository Engine models API", () => {
  it("loads Engine model state using the active repository", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/kody/engine-models", {
        headers: { "x-kody-owner": AUTH.owner, "x-kody-repo": AUTH.repo },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.readVariables).toHaveBeenCalledWith(AUTH.owner, AUTH.repo);
    await expect(response.json()).resolves.toEqual({
      models: [MODEL],
      automatic: { default: false, engineDefault: true },
    });
  });

  it("saves Engine settings to repository variables and syncs Engine config", async () => {
    const response = await PUT(
      new NextRequest("http://localhost/api/kody/engine-models", {
        method: "PUT",
        body: JSON.stringify({
          models: [{ ...MODEL, engineDefault: true }],
          automatic: { default: false, engineDefault: false },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.saveManagedChatModels).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: AUTH.owner,
        repo: AUTH.repo,
        actorLogin: "test-user",
        models: [expect.objectContaining({ engineDefault: true })],
      }),
    );
  });

  it("requires repository authentication", async () => {
    mocks.requireKodyAuth.mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/kody/engine-models"),
    );

    expect(response.status).toBe(401);
    expect(mocks.readVariables).not.toHaveBeenCalled();
  });
});
