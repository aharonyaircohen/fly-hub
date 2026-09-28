import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));
vi.mock("../src/vault/crypto", () => ({
  decrypt: vi.fn(),
  deriveKeyCheck: vi.fn(() => "key-check"),
  encrypt: vi.fn(() => "ciphertext"),
}));

import { writeVault } from "../src/vault/store";

describe("vault write concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backend.mutation.mockResolvedValue("document-id");
  });

  it("passes the read version to the atomic backend write", async () => {
    await writeVault(
      {} as never,
      "acme",
      "widgets",
      { version: 1, secrets: {} },
      "version-1",
    );

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectedUpdatedAt: "version-1" }),
    );
  });

  it("marks a first write as expecting no existing document", async () => {
    await writeVault(
      {} as never,
      "acme",
      "widgets",
      { version: 1, secrets: {} },
      null,
    );

    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectedUpdatedAt: null }),
    );
  });
});
