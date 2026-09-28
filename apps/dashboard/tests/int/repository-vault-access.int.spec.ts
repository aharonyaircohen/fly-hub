import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({
  getAuthenticated: vi.fn(),
  getRepository: vi.fn(),
  query: vi.fn(),
  mutation: vi.fn(),
  scope: vi.fn(),
}));
vi.mock("@kody-ade/base/github/core", () => ({
  createUserOctokit: () => ({
    rest: {
      users: { getAuthenticated: state.getAuthenticated },
      repos: { get: state.getRepository },
    },
  }),
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ query: state.query, mutation: state.mutation }),
}));
vi.mock("@dashboard/lib/auth/kody-request-scope", () => ({
  resolveKodyRequestScope: state.scope,
}));
vi.mock("@kody-ade/base/vault/crypto", () => ({
  isVaultConfigured: () => true,
  decrypt: () =>
    JSON.stringify({
      version: 1,
      secrets: { TEST_KEY: { value: "synthetic-only", updatedAt: "old" } },
    }),
  encrypt: () => "synthetic-ciphertext",
  deriveKeyCheck: () => "synthetic-check",
}));
import { GET, POST } from "../../app/api/kody/secrets/route";
import { DELETE } from "../../app/api/kody/secrets/[name]/route";
import { GET as reveal } from "../../app/api/kody/secrets/[name]/value/route";
import { invalidateVaultCache } from "@kody-ade/base/vault/store";
const params = { params: Promise.resolve({ name: "TEST_KEY" }) };
const endpoints = [
  { name: "metadata", method: "GET", run: GET, read: true },
  { name: "upsert", method: "POST", run: POST, read: false },
  {
    name: "delete",
    method: "DELETE",
    run: (req: NextRequest) => DELETE(req, params),
    read: false,
  },
  {
    name: "reveal",
    method: "GET",
    run: (req: NextRequest) => reveal(req, params),
    read: false,
  },
];
function request(method: string) {
  return new NextRequest("https://audit.invalid/api/kody/secrets", {
    method,
    headers: {
      "x-kody-token": "access-matrix-token",
      "x-kody-owner": "unrelated",
      "x-kody-repo": "private",
      "content-type": "application/json",
    },
    ...(method === "POST"
      ? {
          body: JSON.stringify({
            name: "TEST_KEY",
            value: "synthetic-replacement",
          }),
        }
      : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  invalidateVaultCache("unrelated", "private");
  state.query.mockResolvedValue({
    doc: { ciphertext: "synthetic" },
    updatedAt: "old",
  });
  state.scope.mockResolvedValue({ user: { id: "user" } });
  state.getAuthenticated.mockResolvedValue({
    data: { login: "writer", id: 123, avatar_url: "" },
  });
  state.getRepository.mockResolvedValue({
    data: { permissions: { push: true, pull: true } },
  });
});
describe.each(endpoints)("repository vault $name", ({ method, run, read }) => {
  it("rejects invalid credentials before accessing storage", async () => {
    state.getAuthenticated.mockRejectedValue({ status: 401 });
    expect((await run(request(method))).status).toBe(401);
    expect(state.query).not.toHaveBeenCalled();
    expect(state.mutation).not.toHaveBeenCalled();
  });
  it("rejects an authenticated outsider before accessing storage", async () => {
    state.getRepository.mockRejectedValue({ status: 404 });
    expect((await run(request(method))).status).toBe(404);
    expect(state.query).not.toHaveBeenCalled();
    expect(state.mutation).not.toHaveBeenCalled();
  });
  it("limits read collaborators to metadata", async () => {
    state.getRepository.mockResolvedValue({
      data: { permissions: { pull: true } },
    });
    const result = await run(request(method));
    expect(result.status).toBe(read ? 200 : 403);
    if (!read) expect(state.query).not.toHaveBeenCalled();
    expect(state.mutation).not.toHaveBeenCalled();
  });
  it("uses verified repository access without requiring a personal session", async () => {
    const result = await run(request(method));
    expect(result.status).toBe(200);
    expect(state.getRepository).toHaveBeenCalledWith({
      owner: "unrelated",
      repo: "private",
    });
    expect(state.scope).not.toHaveBeenCalled();
    if (method === "POST" || method === "DELETE")
      expect(state.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: "unrelated/private",
          kind: "secrets.enc",
        }),
      );
  });
});
