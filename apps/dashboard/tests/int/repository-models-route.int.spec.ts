import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  getRequestAuth: vi.fn(),
  getUserOctokit: vi.fn(),
  query: vi.fn(),
  mutation: vi.fn(),
  getRepository: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoReadAccess: mocks.requireKodyAuth,
  verifyRepoWriteAccess: mocks.requireKodyAuth,
  getRequestAuth: mocks.getRequestAuth,
  getUserOctokit: mocks.getUserOctokit,
}));

vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  backendApi: {
    repositoryPreferences: {
      get: "repositoryPreferences.get",
      save: "repositoryPreferences.save",
    },
  },
  getConvexClient: () => ({ query: mocks.query, mutation: mocks.mutation }),
  tenantIdFor: (owner: string, repo: string) => `${owner}/${repo}`,
}));

import { GET, PUT } from "../../app/api/kody/repository-models/route";

const MODEL = {
  id: "anthropic/claude-sonnet-4-6",
  label: "Claude Sonnet 4.6",
  provider: "anthropic",
  protocol: "anthropic",
  baseURL: "https://api.anthropic.com",
  modelName: "claude-sonnet-4-6",
  apiKeySecret: "ANTHROPIC_API_KEY",
  enabled: true,
  default: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireKodyAuth.mockResolvedValue({
    auth: { owner: "acme", repo: "website" },
  });
  mocks.getRequestAuth.mockReturnValue({ owner: "acme", repo: "website" });
  mocks.getRepository.mockResolvedValue({ data: { id: 1 } });
  mocks.getUserOctokit.mockResolvedValue({
    rest: { repos: { get: mocks.getRepository } },
  });
});

describe("repository chat models API", () => {
  it("loads one shared model list for every authenticated repository user", async () => {
    mocks.query.mockResolvedValue({ data: { models: [MODEL], automatic: {} } });

    const response = await GET(
      new NextRequest("http://localhost/api/kody/repository-models"),
    );

    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith("repositoryPreferences.get", {
      tenantId: "acme/website",
      namespace: "chat-models",
    });
    await expect(response.json()).resolves.toMatchObject({ models: [MODEL] });
  });

  it("lets a verified repository writer save the shared list", async () => {
    const response = await PUT(
      new NextRequest("http://localhost/api/kody/repository-models", {
        method: "PUT",
        body: JSON.stringify({ models: [MODEL], automatic: {} }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.mutation).toHaveBeenCalledWith(
      "repositoryPreferences.save",
      expect.objectContaining({
        tenantId: "acme/website",
        namespace: "chat-models",
        data: expect.objectContaining({
          models: [expect.objectContaining(MODEL)],
        }),
      }),
    );
  });

  it("rejects a selected repository the user cannot access", async () => {
    mocks.requireKodyAuth.mockResolvedValueOnce(
      NextResponse.json(
        { error: "repository_not_found_or_inaccessible" },
        { status: 404 },
      ),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/kody/repository-models"),
    );

    expect(response.status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
