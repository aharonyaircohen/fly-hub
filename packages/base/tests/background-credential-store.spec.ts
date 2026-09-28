import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
const crypto = vi.hoisted(() => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(() => "encrypted-value"),
  isConfigured: vi.fn(() => true),
}));

vi.mock("server-only", () => ({}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));
vi.mock("../src/vault/crypto", () => ({
  decrypt: crypto.decrypt,
  encrypt: crypto.encrypt,
  isVaultConfigured: crypto.isConfigured,
}));
vi.mock("../src/vault/bootstrap", () => ({
  _resetBackgroundCredentialCache: vi.fn(),
}));

import {
  readManagedBackgroundCredential,
  writeManagedBackgroundCredential,
} from "../src/auth/background-credential-store";

describe("background credential store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crypto.isConfigured.mockReturnValue(true);
    backend.query.mockResolvedValue(null);
    backend.mutation.mockResolvedValue("document-id");
  });

  it("encrypts the PAT and atomically creates its private document", async () => {
    await writeManagedBackgroundCredential({
      owner: "acme",
      repo: "widgets",
      token: "github_pat_secret",
      actorLogin: "alice",
      updatedAt: "2026-08-07T00:00:00.000Z",
    });

    expect(crypto.encrypt).toHaveBeenCalledWith(
      expect.stringContaining("github_pat_secret"),
    );
    const mutationArgs = backend.mutation.mock.calls[0]?.[1];
    expect(mutationArgs).toMatchObject({
      tenantId: "acme/widgets",
      kind: "background-github-credential",
      doc: { ciphertext: "encrypted-value" },
    });
    expect(mutationArgs).not.toHaveProperty("expectedUpdatedAt");
    expect(JSON.stringify(mutationArgs)).not.toContain("github_pat_secret");
  });

  it("decrypts only a valid managed credential", async () => {
    backend.query.mockResolvedValue({
      doc: { ciphertext: "encrypted-value" },
      updatedAt: "version-1",
    });
    crypto.decrypt.mockReturnValue(
      JSON.stringify({
        version: 1,
        provider: "pat",
        token: "github_pat_secret",
        updatedAt: "2026-08-07T00:00:00.000Z",
      }),
    );

    await expect(
      readManagedBackgroundCredential("acme", "widgets"),
    ).resolves.toBe("github_pat_secret");
  });
});
