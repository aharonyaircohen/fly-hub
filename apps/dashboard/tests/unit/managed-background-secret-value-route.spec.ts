import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  verifyRepoWriteAccess: vi.fn(),
  readVault: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: vi.fn(() => null),
  getRequestAuth: vi.fn(() => ({ owner: "acme", repo: "widgets" })),
  getUserOctokit: vi.fn(() => ({})),
  verifyRepoWriteAccess: dependencies.verifyRepoWriteAccess,
}));
vi.mock("@kody-ade/base/vault/store", () => ({
  readVault: dependencies.readVault,
}));
vi.mock("@kody-ade/base/vault/crypto", () => ({
  isVaultConfigured: vi.fn(() => true),
}));
vi.mock("@kody-ade/base/logger", () => ({
  logger: { error: vi.fn() },
}));
vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: vi.fn(async () => ({ id: "user-1", label: "Alice" })),
}));

import { GET } from "../../app/api/kody/secrets/[name]/value/route";

describe("managed background credential secret boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.verifyRepoWriteAccess.mockResolvedValue({
      auth: { owner: "acme", repo: "widgets" },
      octokit: {},
      permission: "admin",
      actorLogin: "alice",
      actorGithubId: 1,
    });
  });

  it("never returns the retired managed PAT through the user secret API", async () => {
    const response = await GET(
      new NextRequest("https://dashboard.example.com/api/kody/secrets/value", {
        headers: {
          "x-kody-token": "any-value",
          "x-kody-owner": "acme",
          "x-kody-repo": "widgets",
        },
      }),
      { params: Promise.resolve({ name: "KODY_GITHUB_TOKEN" }) },
    );

    expect(response.status).toBe(404);
    expect(dependencies.readVault).not.toHaveBeenCalled();
  });

  it("verifies repository write access before returning a user secret", async () => {
    dependencies.readVault.mockResolvedValue({
      doc: {
        version: 1,
        secrets: {
          USER_SECRET: {
            value: "secret-value",
            updatedAt: "2026-08-07T00:00:00.000Z",
          },
        },
      },
      sha: "version-1",
    });
    const request = new NextRequest(
      "https://dashboard.example.com/api/kody/secrets/USER_SECRET/value",
    );

    const response = await GET(request, {
      params: Promise.resolve({ name: "USER_SECRET" }),
    });

    expect(dependencies.verifyRepoWriteAccess).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "USER_SECRET",
      value: "secret-value",
    });
  });
});
