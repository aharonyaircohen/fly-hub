import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  readVariables: vi.fn(),
}));

vi.mock("@kody-ade/base/variables/store", () => ({
  readVariables: h.readVariables,
}));

import {
  resolveExternalIdentityConfig,
  verifyExternalLaunchAssertion,
} from "../../src/dashboard/lib/client-session/external-identity";

const TARGET = {
  owner: "A-Guy-educ",
  repo: "A-Guy-Teacher",
  brandSlug: "acme",
};

const CONFIG = {
  issuer: "https://identity.example",
  audience: "kody-brand-chat",
  jwksUrl: "https://identity.example/.well-known/jwks.json",
};

function expectedSubject(issuer: string, subject: string): string {
  return `federated:${createHash("sha256")
    .update(issuer)
    .update("\0")
    .update(subject)
    .digest("hex")}`;
}

function validPayload() {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "user-123",
    iss: CONFIG.issuer,
    aud: CONFIG.audience,
    iat: now,
    exp: now + 60,
    jti: "launch-123",
    tenant_id: `${TARGET.owner}/${TARGET.repo}`,
    brand_slug: TARGET.brandSlug,
    name: "Jane",
    email: "jane@example.com",
  };
}

describe("external client identity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only the stable identity from an exact, one-time assertion", async () => {
    const consumeToken = vi.fn().mockResolvedValue(true);

    await expect(
      verifyExternalLaunchAssertion("jwt", TARGET, CONFIG, {
        verifyJwt: vi.fn().mockResolvedValue(validPayload()),
        consumeToken,
      }),
    ).resolves.toEqual({
      subject: expectedSubject(CONFIG.issuer, "user-123"),
      kind: "external",
    });
    expect(consumeToken).toHaveBeenCalledWith(
      `${TARGET.owner}/${TARGET.repo}`,
      "launch-123",
      expect.any(Number),
    );
  });

  it("rejects an assertion issued for another brand", async () => {
    const payload = { ...validPayload(), brand_slug: "other" };

    await expect(
      verifyExternalLaunchAssertion("jwt", TARGET, CONFIG, {
        verifyJwt: vi.fn().mockResolvedValue(payload),
        consumeToken: vi.fn(),
      }),
    ).rejects.toThrow("scope");
  });

  it("rejects a replayed assertion", async () => {
    await expect(
      verifyExternalLaunchAssertion("jwt", TARGET, CONFIG, {
        verifyJwt: vi.fn().mockResolvedValue(validPayload()),
        consumeToken: vi.fn().mockResolvedValue(false),
      }),
    ).rejects.toThrow("already used");
  });

  it("reads an HTTPS issuer contract from repository variables", async () => {
    h.readVariables.mockResolvedValue({
      doc: {
        variables: {
          CLIENT_IDENTITY_ISSUER: { value: "https://identity.example/" },
          CLIENT_IDENTITY_AUDIENCE: { value: "kody-brand-chat" },
          CLIENT_IDENTITY_JWKS_URL: {
            value: "https://identity.example/.well-known/jwks.json",
          },
        },
      },
    });

    await expect(
      resolveExternalIdentityConfig(TARGET.owner, TARGET.repo),
    ).resolves.toEqual(CONFIG);
  });

  it("rejects issuer keys hosted by a different origin", async () => {
    h.readVariables.mockResolvedValue({
      doc: {
        variables: {
          CLIENT_IDENTITY_ISSUER: { value: "https://identity.example" },
          CLIENT_IDENTITY_AUDIENCE: { value: "kody-brand-chat" },
          CLIENT_IDENTITY_JWKS_URL: {
            value: "https://attacker.example/jwks.json",
          },
        },
      },
    });

    await expect(
      resolveExternalIdentityConfig(TARGET.owner, TARGET.repo),
    ).rejects.toThrow("HTTPS origin");
  });

  it("allows matching loopback HTTP identity URLs in local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    h.readVariables.mockResolvedValue({
      doc: {
        variables: {
          CLIENT_IDENTITY_ISSUER: { value: "http://localhost:3000" },
          CLIENT_IDENTITY_AUDIENCE: { value: "kody-brand-chat" },
          CLIENT_IDENTITY_JWKS_URL: {
            value: "http://localhost:3000/.well-known/jwks.json",
          },
        },
      },
    });

    await expect(
      resolveExternalIdentityConfig(TARGET.owner, TARGET.repo),
    ).resolves.toEqual({
      issuer: "http://localhost:3000",
      audience: "kody-brand-chat",
      jwksUrl: "http://localhost:3000/.well-known/jwks.json",
    });
  });

  it("rejects non-loopback HTTP identity URLs in local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    h.readVariables.mockResolvedValue({
      doc: {
        variables: {
          CLIENT_IDENTITY_ISSUER: { value: "http://identity.example" },
          CLIENT_IDENTITY_AUDIENCE: { value: "kody-brand-chat" },
          CLIENT_IDENTITY_JWKS_URL: {
            value: "http://identity.example/jwks.json",
          },
        },
      },
    });

    await expect(
      resolveExternalIdentityConfig(TARGET.owner, TARGET.repo),
    ).rejects.toThrow("loopback HTTP");
  });

  it("rejects loopback HTTP identity URLs outside local development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    h.readVariables.mockResolvedValue({
      doc: {
        variables: {
          CLIENT_IDENTITY_ISSUER: { value: "http://localhost:3000" },
          CLIENT_IDENTITY_AUDIENCE: { value: "kody-brand-chat" },
          CLIENT_IDENTITY_JWKS_URL: { value: "http://localhost:3000/jwks.json" },
        },
      },
    });

    await expect(
      resolveExternalIdentityConfig(TARGET.owner, TARGET.repo),
    ).rejects.toThrow("local development");
  });

  it("verifies a real ES256 assertion against the host public key", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", {
      extractable: true,
    });
    const jwk = await exportJWK(publicKey);
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          keys: [{ ...jwk, alg: "ES256", use: "sig", kid: "test-key" }],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test JWKS server did not start");
      }
      const issuer = `http://127.0.0.1:${address.port}`;
      const now = Math.floor(Date.now() / 1000);
      const assertion = await new SignJWT({
        tenant_id: `${TARGET.owner}/${TARGET.repo}`,
        brand_slug: TARGET.brandSlug,
      })
        .setProtectedHeader({ alg: "ES256", kid: "test-key" })
        .setIssuer(issuer)
        .setAudience(CONFIG.audience)
        .setSubject("opaque-user-123")
        .setJti("real-launch")
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .sign(privateKey);

      await expect(
        verifyExternalLaunchAssertion(
          assertion,
          TARGET,
          {
            issuer,
            audience: CONFIG.audience,
            jwksUrl: `${issuer}/jwks`,
          },
          { consumeToken: vi.fn().mockResolvedValue(true) },
        ),
      ).resolves.toEqual({
        subject: expectedSubject(issuer, "opaque-user-123"),
        kind: "external",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
