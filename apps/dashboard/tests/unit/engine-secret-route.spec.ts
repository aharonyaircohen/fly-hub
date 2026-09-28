import { beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({
  verify: vi.fn(),
}));
const backend = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));
const crypto = vi.hoisted(() => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}));

vi.mock("@dashboard/lib/backend/github-actions-identity", () => ({
  bearerToken: (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null,
  verifyGitHubWorkflowIdentity: identity.verify,
}));

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));

vi.mock("@kody-ade/base/vault/crypto", () => crypto);

import { PUT } from "../../app/api/kody/engine/secret/route";

function request(body: unknown) {
  return new Request("http://localhost/api/kody/engine/secret", {
    method: "PUT",
    headers: {
      authorization: "Bearer signed-github-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  identity.verify.mockResolvedValue({
    repository: "trusted/repo",
    workflowRef: "trusted/repo/.github/workflows/kody.yml@refs/heads/main",
    actor: "kodyade[bot]",
    runId: "42",
  });
  backend.mutation.mockResolvedValue(null);
  crypto.encrypt.mockReturnValue("encrypted-next-vault");
});

describe("PUT /api/kody/engine/secret", () => {
  it("atomically upserts only into the signed repository and preserves existing secrets", async () => {
    backend.query.mockResolvedValue({
      doc: { ciphertext: "encrypted-current-vault" },
    });
    crypto.decrypt.mockReturnValue(
      JSON.stringify({
        version: 1,
        secrets: {
          EXISTING_SECRET: {
            value: "keep",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
    );

    const response = await PUT(
      request({
        secrets: {
          VERCEL_ACCESS_TOKEN: "migrated",
          VERCEL_PROJECT_ID: "project",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(backend.query).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "trusted/repo",
      kind: "secrets.enc",
    });
    expect(crypto.encrypt).toHaveBeenCalledWith(
      expect.stringContaining('"EXISTING_SECRET"'),
    );
    expect(crypto.encrypt).toHaveBeenCalledWith(
      expect.stringContaining('"VERCEL_ACCESS_TOKEN"'),
    );
    expect(crypto.encrypt).toHaveBeenCalledWith(
      expect.stringContaining('"VERCEL_PROJECT_ID"'),
    );
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "trusted/repo",
        kind: "secrets.enc",
        doc: { ciphertext: "encrypted-next-vault" },
      }),
    );
  });

  it("rejects invalid secret names before touching persistence", async () => {
    const response = await PUT(
      request({ secrets: { "bad-name": "secret" } }),
    );

    expect(response.status).toBe(400);
    expect(backend.query).not.toHaveBeenCalled();
    expect(backend.mutation).not.toHaveBeenCalled();
  });
});
