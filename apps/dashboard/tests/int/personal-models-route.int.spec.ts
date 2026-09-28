import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireKodyUser: vi.fn(),
  getRequestAuth: vi.fn(),
  getUserOctokit: vi.fn(),
  getRepository: vi.fn(),
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: mocks.requireKodyUser,
}));

vi.mock("@kody-ade/base/auth", () => ({
  getRequestAuth: mocks.getRequestAuth,
  getUserOctokit: mocks.getUserOctokit,
}));

vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  backendApi: {
    userPreferences: {
      get: "userPreferences.get",
      save: "userPreferences.save",
    },
    repositoryPreferences: { get: "repositoryPreferences.get" },
  },
  tenantIdFor: (owner: string, repo: string) => `${owner}/${repo}`,
  getConvexClient: () => ({
    query: mocks.query,
    mutation: mocks.mutation,
  }),
}));

import { GET, PUT } from "../../app/api/kody/models/route";

const USER = { id: "kody-user-1", label: "Alice", email: "alice@test.dev" };
const MODEL = {
  id: "minimax/MiniMax-M3",
  label: "MiniMax M3",
  provider: "minimax",
  protocol: "openai",
  baseURL: "https://api.minimax.io/v1",
  modelName: "MiniMax-M3",
  apiKeySecret: "MINIMAX_API_KEY",
  enabled: true,
  default: true,
  service: {
    machine: "local",
    startCommand: "llama-server --port 8080",
    stopCommand: "pkill -INT -f llama-server",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireKodyUser.mockResolvedValue(USER);
  mocks.getRequestAuth.mockReturnValue(null);
});

describe("personal models API", () => {
  it("loads models by the authenticated Kody user without repository context", async () => {
    mocks.query.mockResolvedValue({
      data: { models: [MODEL], automatic: { default: false } },
    });

    const response = await GET(
      new NextRequest("http://localhost/api/kody/models"),
    );

    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith("userPreferences.get", {
      namespace: "chat-models",
      userKey: USER.id,
    });
    await expect(response.json()).resolves.toMatchObject({ models: [MODEL] });
  });

  it("stores only chat settings and never repository Engine defaults", async () => {
    const response = await PUT(
      new NextRequest("http://localhost/api/kody/models", {
        method: "PUT",
        body: JSON.stringify({
          models: [{ ...MODEL, engineDefault: true }],
          automatic: { default: false, engineDefault: true },
          actorLogin: "forged-github-user",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.mutation).toHaveBeenCalledWith(
      "userPreferences.save",
      expect.objectContaining({
        namespace: "chat-models",
        userKey: USER.id,
        data: {
          models: [expect.objectContaining({ ...MODEL, engineDefault: false })],
          automatic: { default: false, engineDefault: false },
        },
      }),
    );
  });

  it("returns personal and repository models together in repository chat", async () => {
    mocks.getRequestAuth.mockReturnValue({ owner: "acme", repo: "website" });
    mocks.getRepository.mockResolvedValue({ data: { id: 1 } });
    mocks.getUserOctokit.mockResolvedValue({
      rest: { repos: { get: mocks.getRepository } },
    });
    mocks.query
      .mockResolvedValueOnce({ data: { models: [MODEL], automatic: {} } })
      .mockResolvedValueOnce({
        data: {
          models: [
            { ...MODEL, id: "anthropic/repository", label: "Repository" },
          ],
          automatic: {},
        },
      });

    const response = await GET(
      new NextRequest("http://localhost/api/kody/models"),
    );

    await expect(response.json()).resolves.toMatchObject({
      models: [
        { id: "repo::anthropic/repository", scope: "repo" },
        { id: "personal::minimax/MiniMax-M3", scope: "personal" },
      ],
    });
  });

  it("stops before storage when the Kody session is missing", async () => {
    mocks.requireKodyUser.mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/kody/models"),
    );

    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
