import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: { repoDocs: { get: "repoDocs.get" } },
}));

import { encrypt } from "@kody-ade/base/vault/crypto";
import {
  _resetBackgroundCredentialCache,
  resolvePublicStateVariable,
  resolveVaultGithubToken,
} from "@kody-ade/base/vault/bootstrap";

const KEY = randomBytes(32).toString("hex");

describe("Convex background credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetBackgroundCredentialCache();
    process.env.KODY_MASTER_KEY = KEY;
  });

  it("decrypts a vault secret from Convex without GitHub", async () => {
    backend.query.mockResolvedValue({
      doc: {
        ciphertext: encrypt(
          JSON.stringify({
            version: 1,
            secrets: {
              GITHUB_TOKEN: {
                value: "ghp_convex_token",
                updatedAt: "2026-06-24T00:00:00.000Z",
              },
            },
          }),
        ),
      },
    });
    const fetchImpl = vi.fn();

    await expect(
      resolveVaultGithubToken(
        "acme",
        "convex-vault",
        "GITHUB_TOKEN",
        fetchImpl,
      ),
    ).resolves.toBe("ghp_convex_token");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(backend.query).toHaveBeenCalledWith("repoDocs.get", {
      tenantId: "acme/convex-vault",
      kind: "secrets.enc",
    });
  });

  it("reads a public variable from Convex without GitHub", async () => {
    backend.query.mockResolvedValue({
      doc: {
        version: 1,
        variables: {
          CLIENT_ID: {
            value: "convex-client-id",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
        },
      },
    });

    await expect(
      resolvePublicStateVariable("acme", "convex-vars", "CLIENT_ID"),
    ).resolves.toBe("convex-client-id");
  });

  it("does not cache a temporary backend failure as missing configuration", async () => {
    backend.query
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce({
        doc: {
          version: 1,
          variables: {
            CLIENT_ID: {
              value: "available-after-retry",
              updatedAt: "2026-06-24T00:00:00.000Z",
            },
          },
        },
      });

    await expect(
      resolvePublicStateVariable("acme", "retry", "CLIENT_ID"),
    ).rejects.toThrow("temporary outage");
    await expect(
      resolvePublicStateVariable("acme", "retry", "CLIENT_ID"),
    ).resolves.toBe("available-after-retry");
  });
});
