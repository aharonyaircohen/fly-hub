import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireKodyUser: vi.fn(),
  query: vi.fn(),
  mutation: vi.fn(),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
}));

vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: mocks.requireKodyUser,
}));

vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  backendApi: {
    userCredentials: {
      list: "userCredentials.list",
      upsert: "userCredentials.upsert",
    },
  },
  getConvexClient: () => ({
    query: mocks.query,
    mutation: mocks.mutation,
  }),
}));

vi.mock("@kody-ade/base/vault/crypto", () => ({
  encrypt: mocks.encrypt,
  isVaultConfigured: () => true,
}));

import { GET, PUT } from "../../app/api/kody/account/credentials/route";

const USER = { id: "kody-user-1", label: "Alice", email: "alice@test.dev" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireKodyUser.mockResolvedValue(USER);
});

describe("personal credentials API", () => {
  it("lists metadata for only the authenticated user", async () => {
    mocks.query.mockResolvedValue([
      { name: "MINIMAX_API_KEY", updatedAt: "2026-08-17T00:00:00.000Z" },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/kody/account/credentials"),
    );

    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith("userCredentials.list", {
      userKey: USER.id,
    });
    const json = await response.json();
    expect(json.credentials).toEqual([
      { name: "MINIMAX_API_KEY", updatedAt: "2026-08-17T00:00:00.000Z" },
    ]);
    expect(JSON.stringify(json)).not.toContain("encrypted");
  });

  it("encrypts a credential before storage and never returns its value", async () => {
    const secret = "sk-private-value";
    const response = await PUT(
      new NextRequest("http://localhost/api/kody/account/credentials", {
        method: "PUT",
        body: JSON.stringify({ name: "MINIMAX_API_KEY", value: secret }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.encrypt).toHaveBeenCalledWith(secret);
    expect(mocks.mutation).toHaveBeenCalledWith(
      "userCredentials.upsert",
      expect.objectContaining({
        userKey: USER.id,
        name: "MINIMAX_API_KEY",
        encryptedValue: `encrypted:${secret}`,
      }),
    );
    expect(JSON.stringify(await response.json())).not.toContain(secret);
  });

  it("rejects invalid names before encryption", async () => {
    const response = await PUT(
      new NextRequest("http://localhost/api/kody/account/credentials", {
        method: "PUT",
        body: JSON.stringify({ name: "bad-name", value: "secret" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("stops before storage when the Kody session is missing", async () => {
    mocks.requireKodyUser.mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/kody/account/credentials"),
    );

    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
