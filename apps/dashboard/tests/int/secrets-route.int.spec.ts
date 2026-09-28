import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  configured: vi.fn(() => true),
  query: vi.fn(),
  mutation: vi.fn(),
  readVault: vi.fn(),
  upsertSecret: vi.fn(),
}));

vi.mock("@dashboard/lib/auth/kody-request-scope", () => ({
  resolveKodyRequestScope: state.auth,
}));
vi.mock("@kody-ade/base/vault/crypto", () => ({
  isVaultConfigured: state.configured,
  encrypt: (value: string) => `encrypted:${value}`,
}));
vi.mock("@kody-ade/base/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kody-ade/base/auth")>();
  return {
    ...actual,
    verifyRepoReadAccess: vi.fn(async () => ({
      auth: { owner: "acme", repo: "app" },
      octokit: {},
      actorLogin: "alice",
    })),
    verifyRepoWriteAccess: vi.fn(async () => ({
      auth: { owner: "acme", repo: "app" },
      octokit: {},
      actorLogin: "alice",
    })),
  };
});
vi.mock("@kody-ade/base/vault/store", () => ({
  readVault: state.readVault,
  listSecretMetadata: (doc: { secrets: Array<{ name: string }> }) =>
    doc.secrets,
}));
vi.mock("@kody-ade/base/vault/mutations", () => ({
  upsertSecret: state.upsertSecret,
}));
vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  backendApi: {
    userCredentials: { list: "list", upsert: "upsert" },
  },
  getConvexClient: () => ({ query: state.query, mutation: state.mutation }),
}));

import { GET, POST } from "../../app/api/kody/secrets/route";

function request(body?: unknown) {
  return new NextRequest("https://dash.test/api/kody/secrets", {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function repositoryRequest(body?: unknown) {
  return new NextRequest("https://dash.test/api/kody/secrets", {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      "x-kody-owner": "acme",
      "x-kody-repo": "app",
      "x-kody-token": "token",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.configured.mockReturnValue(true);
  state.auth.mockResolvedValue({
    user: { id: "user-1", label: "Alice" },
    personalTenantId: "user:user-1",
  });
  state.query.mockResolvedValue([
    { name: "EXISTING_KEY", updatedAt: "2026-01-01T00:00:00Z" },
  ]);
  state.readVault.mockResolvedValue({
    doc: { secrets: [{ name: "REPOSITORY_KEY" }] },
  });
  state.upsertSecret.mockResolvedValue({
    secrets: [{ name: "REPOSITORY_KEY" }],
  });
});

describe("repository secrets API", () => {
  it("does not require a personal Kody session for authenticated repository reads", async () => {
    state.auth.mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );

    const response = await GET(repositoryRequest());

    expect(response.status).toBe(200);
    expect(state.auth).not.toHaveBeenCalled();
    expect(state.readVault).toHaveBeenCalledWith({}, "acme", "app");
  });

  it("keeps repository reads in the repository vault", async () => {
    const response = await GET(repositoryRequest());

    expect(response.status).toBe(200);
    expect(state.readVault).toHaveBeenCalledWith({}, "acme", "app");
    expect(state.query).not.toHaveBeenCalled();
  });

  it("keeps repository writes in the repository vault", async () => {
    const response = await POST(
      repositoryRequest({ name: "REPOSITORY_KEY", value: "secret" }),
    );

    expect(response.status).toBe(200);
    expect(state.upsertSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "app",
        name: "REPOSITORY_KEY",
        value: "secret",
        actorLogin: "alice",
      }),
    );
    expect(state.mutation).not.toHaveBeenCalled();
  });
});

describe("personal secrets API", () => {
  it("requires a signed-in Kody user", async () => {
    state.auth.mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    expect((await GET(request())).status).toBe(401);
  });

  it("lists metadata without secret values", async () => {
    const response = await GET(request());
    expect(await response.json()).toEqual({
      secrets: [{ name: "EXISTING_KEY", updatedAt: "2026-01-01T00:00:00Z" }],
    });
  });

  it("encrypts a valid secret under the Kody user", async () => {
    const response = await POST(
      request({ name: "MINIMAX_API_KEY", value: "secret-value" }),
    );
    expect(response.status).toBe(200);
    expect(state.mutation).toHaveBeenCalledWith("upsert", {
      userKey: "user-1",
      name: "MINIMAX_API_KEY",
      encryptedValue: "encrypted:secret-value",
      updatedAt: expect.any(String),
    });
    expect(JSON.stringify(await response.json())).not.toContain("secret-value");
  });

  it("rejects invalid names before writing", async () => {
    const response = await POST(request({ name: "bad name", value: "x" }));
    expect(response.status).toBe(400);
    expect(state.mutation).not.toHaveBeenCalled();
  });
});
