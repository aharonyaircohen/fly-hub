import { beforeEach, describe, expect, it, vi } from "vitest";

const readVaultMock = vi.hoisted(() => vi.fn());
const writeVaultMock = vi.hoisted(() => vi.fn());
const invalidateVaultCacheMock = vi.hoisted(() => vi.fn());

vi.mock("../src/vault/store", () => ({
  readVault: readVaultMock,
  writeVault: writeVaultMock,
  invalidateVaultCache: invalidateVaultCacheMock,
  listSecretMetadata: (doc: { secrets: Record<string, unknown> }) =>
    Object.keys(doc.secrets).map((name) => ({ name })),
}));

import { upsertSecret } from "../src/vault/mutations";

describe("shared vault mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readVaultMock.mockResolvedValue({
      doc: { version: 1, secrets: {} },
      sha: null,
    });
    writeVaultMock.mockResolvedValue({ sha: "next" });
  });

  it("writes a secret once and returns metadata only", async () => {
    const result = await upsertSecret({
      octokit: {} as never,
      owner: "acme",
      repo: "app",
      name: "OPENROUTER_API_KEY",
      value: "secret-value",
      actorLogin: "alice",
      now: "2026-08-05T00:00:00.000Z",
    });

    expect(writeVaultMock).toHaveBeenCalledOnce();
    expect(result.secrets).toEqual([{ name: "OPENROUTER_API_KEY" }]);
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(invalidateVaultCacheMock).toHaveBeenCalledWith("acme", "app");
  });
});
