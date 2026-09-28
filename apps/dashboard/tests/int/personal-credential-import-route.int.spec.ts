import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireKodyUser: vi.fn(),
  verifyRepoWriteAccess: vi.fn(),
  readVault: vi.fn(),
  mutation: vi.fn(),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
}));

vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: mocks.requireKodyUser,
}));
vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoWriteAccess: mocks.verifyRepoWriteAccess,
}));
vi.mock("@kody-ade/base/vault/store", () => ({ readVault: mocks.readVault }));
vi.mock("@kody-ade/base/vault/crypto", () => ({
  encrypt: mocks.encrypt,
  isVaultConfigured: () => true,
}));
vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  backendApi: { userCredentials: { upsert: "userCredentials.upsert" } },
  getConvexClient: () => ({ mutation: mocks.mutation }),
}));

import { POST } from "../../app/api/kody/account/credentials/import/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireKodyUser.mockResolvedValue({ id: "user-1", label: "Alice" });
  mocks.verifyRepoWriteAccess.mockResolvedValue({
    auth: { owner: "acme", repo: "widgets" },
    octokit: {},
  });
  mocks.readVault.mockResolvedValue({
    doc: {
      secrets: {
        MINIMAX_API_KEY: { value: "repo-secret", updatedAt: "now" },
      },
    },
  });
});

describe("personal credential import", () => {
  it("copies a selected repository credential into the authenticated account", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/kody/account/credentials/import", {
        method: "POST",
        body: JSON.stringify({ name: "MINIMAX_API_KEY" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.mutation).toHaveBeenCalledWith(
      "userCredentials.upsert",
      expect.objectContaining({
        userKey: "user-1",
        name: "MINIMAX_API_KEY",
        encryptedValue: "encrypted:repo-secret",
      }),
    );
    expect(JSON.stringify(await response.json())).not.toContain("repo-secret");
  });

  it("requires repository write access", async () => {
    mocks.verifyRepoWriteAccess.mockResolvedValueOnce(
      NextResponse.json({ error: "no_repo_context" }, { status: 400 }),
    );
    const response = await POST(
      new NextRequest("http://localhost/api/kody/account/credentials/import", {
        method: "POST",
        body: JSON.stringify({ name: "MINIMAX_API_KEY" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.readVault).not.toHaveBeenCalled();
  });
});
