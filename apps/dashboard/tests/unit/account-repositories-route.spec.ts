import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  query: vi.fn(),
  mutation: vi.fn(),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  decrypt: vi.fn((value: string) => value.replace(/^encrypted:/, "")),
}));

vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: mocks.user,
}));
vi.mock("@kody-ade/base/vault/crypto", () => ({
  isVaultConfigured: () => true,
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
}));
vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  backendApi: {
    userCredentials: {
      get: "credentials.get",
      upsert: "credentials.upsert",
      remove: "credentials.remove",
    },
  },
  getConvexClient: () => ({ query: mocks.query, mutation: mocks.mutation }),
}));

import {
  DELETE,
  GET,
  PUT,
} from "../../app/api/kody/account/repositories/route";

const auth = {
  repoUrl: "https://github.com/acme/app",
  owner: "acme",
  repo: "app",
  token: "secret-token",
  user: { login: "alice", avatar_url: "", id: 1 },
  loggedInAt: 1,
  repos: [
    {
      repoUrl: "https://github.com/acme/app",
      owner: "acme",
      repo: "app",
      token: "secret-token",
      addedAt: 1,
      isLogin: true,
      user: { login: "alice", avatar_url: "", id: 1 },
    },
  ],
  currentRepoIndex: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "user-1", label: "Alice" });
});

describe("account repository connections", () => {
  it("returns only the signed-in user's encrypted repository state", async () => {
    mocks.query.mockResolvedValue({
      encryptedValue: `encrypted:${JSON.stringify(auth)}`,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ auth });
    expect(mocks.query).toHaveBeenCalledWith("credentials.get", {
      userKey: "user-1",
      name: "KODY_INTERNAL_REPOSITORY_CONNECTIONS",
    });
  });

  it("encrypts repository tokens under the signed-in Kody account", async () => {
    const response = await PUT(
      new NextRequest("https://dash.test/api/kody/account/repositories", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.mutation).toHaveBeenCalledWith(
      "credentials.upsert",
      expect.objectContaining({
        userKey: "user-1",
        name: "KODY_INTERNAL_REPOSITORY_CONNECTIONS",
        encryptedValue: expect.stringContaining("encrypted:"),
      }),
    );
  });

  it("rejects oversized repository collections", async () => {
    const response = await PUT(
      new NextRequest("https://dash.test/api/kody/account/repositories", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth: {
            ...auth,
            repos: Array.from({ length: 101 }, () => auth.repos[0]),
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("clears only the signed-in user's repository state", async () => {
    expect((await DELETE()).status).toBe(200);
    expect(mocks.mutation).toHaveBeenCalledWith("credentials.remove", {
      userKey: "user-1",
      name: "KODY_INTERNAL_REPOSITORY_CONNECTIONS",
    });
  });

  it("rejects requests without a Kody account", async () => {
    mocks.user.mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    expect((await GET()).status).toBe(401);
  });
});
