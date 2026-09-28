import "server-only";

import { createHash } from "node:crypto";
import { createBackendClient } from "@kody-ade/backend/client";
import { api } from "@kody-ade/backend/api";
import { readVariables } from "@kody-ade/base/variables/store";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import type { ClientIdentity } from "./session";

const MAX_LAUNCH_LIFETIME_SEC = 5 * 60;
const MAX_REMOTE_KEY_SETS = 100;
const remoteKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export interface ExternalIdentityConfig {
  issuer: string;
  audience: string;
  jwksUrl: string;
}

interface LaunchTarget {
  owner: string;
  repo: string;
  brandSlug: string;
}

type VerifyJwt = (
  token: string,
  config: ExternalIdentityConfig,
) => Promise<JWTPayload>;
type ConsumeToken = (
  tenantId: string,
  tokenId: string,
  expiresAt: number,
) => Promise<boolean>;

function requiredString(
  payload: Record<string, unknown>,
  name: string,
  maxLength: number,
): string {
  const value = payload[name];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`Launch assertion is missing ${name}`);
  }
  return value;
}

function federatedSubject(issuer: string, subject: string): string {
  const digest = createHash("sha256")
    .update(issuer)
    .update("\0")
    .update(subject)
    .digest("hex");
  return `federated:${digest}`;
}

async function verifyJwt(
  token: string,
  config: ExternalIdentityConfig,
): Promise<JWTPayload> {
  let keySet = remoteKeys.get(config.jwksUrl);
  if (!keySet) {
    if (remoteKeys.size >= MAX_REMOTE_KEY_SETS) {
      const oldest = remoteKeys.keys().next().value;
      if (oldest) remoteKeys.delete(oldest);
    }
    keySet = createRemoteJWKSet(new URL(config.jwksUrl));
    remoteKeys.set(config.jwksUrl, keySet);
  }
  const { payload } = await jwtVerify(token, keySet, {
    algorithms: ["RS256", "ES256", "EdDSA"],
    issuer: config.issuer,
    audience: config.audience,
    maxTokenAge: MAX_LAUNCH_LIFETIME_SEC,
  });
  return payload;
}

async function consumeToken(
  tenantId: string,
  tokenId: string,
  expiresAt: number,
): Promise<boolean> {
  return (await createBackendClient().mutation(api.clientLaunchNonces.consume, {
    tenantId,
    tokenId,
    expiresAt,
    now: Math.floor(Date.now() / 1000),
  })) as boolean;
}

export async function resolveExternalIdentityConfig(
  owner: string,
  repo: string,
): Promise<ExternalIdentityConfig | null> {
  const { doc } = await readVariables(owner, repo);
  const issuer = doc.variables.CLIENT_IDENTITY_ISSUER?.value?.trim();
  const audience = doc.variables.CLIENT_IDENTITY_AUDIENCE?.value?.trim();
  const jwksUrl = doc.variables.CLIENT_IDENTITY_JWKS_URL?.value?.trim();
  if (!issuer || !audience || !jwksUrl) return null;

  const issuerUrl = new URL(issuer);
  const keysUrl = new URL(jwksUrl);
  const isDevelopment = process.env.NODE_ENV === "development";
  const isLoopback = (url: URL) =>
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  const secureOrigin =
    issuerUrl.protocol === "https:" && keysUrl.protocol === "https:";
  const localDevelopmentOrigin =
    isDevelopment &&
    issuerUrl.protocol === "http:" &&
    keysUrl.protocol === "http:" &&
    isLoopback(issuerUrl) &&
    isLoopback(keysUrl);
  if (
    (!secureOrigin && !localDevelopmentOrigin) ||
    issuerUrl.origin !== keysUrl.origin
  ) {
    throw new Error(
      "Client identity issuer and JWKS URL must share an HTTPS origin; loopback HTTP is allowed only in local development",
    );
  }
  return {
    issuer: issuerUrl.toString().replace(/\/$/, ""),
    audience,
    jwksUrl: keysUrl.toString(),
  };
}

export async function verifyExternalLaunchAssertion(
  token: string,
  target: LaunchTarget,
  config: ExternalIdentityConfig,
  dependencies: {
    verifyJwt?: VerifyJwt;
    consumeToken?: ConsumeToken;
  } = {},
): Promise<ClientIdentity> {
  const payload = await (dependencies.verifyJwt ?? verifyJwt)(token, config);
  const subject = requiredString(payload, "sub", 300);
  const tokenId = requiredString(payload, "jti", 300);
  const tenantId = requiredString(payload, "tenant_id", 201);
  const brandSlug = requiredString(payload, "brand_slug", 80);
  const expectedTenant = `${target.owner}/${target.repo}`;
  if (tenantId !== expectedTenant || brandSlug !== target.brandSlug) {
    throw new Error(
      "Launch assertion scope does not match this client surface",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof payload.exp !== "number" ||
    payload.exp <= now ||
    payload.exp > now + MAX_LAUNCH_LIFETIME_SEC
  ) {
    throw new Error("Launch assertion expiry is invalid");
  }
  const consumed = await (dependencies.consumeToken ?? consumeToken)(
    tenantId,
    tokenId,
    payload.exp,
  );
  if (!consumed) throw new Error("Launch assertion was already used");

  return {
    subject: federatedSubject(config.issuer, subject),
    kind: "external",
  };
}
