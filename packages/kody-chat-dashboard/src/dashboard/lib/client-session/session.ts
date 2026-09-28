/**
 * Internal Brand Chat session.
 *
 * Host-specific identity is converted to this one small contract before Chat
 * sees it. The signed token is stored only in an HttpOnly cookie.
 */
import "server-only";

import { hkdfSync } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const CLIENT_SESSION_COOKIE = "kody_client_session";
export const CLIENT_SESSION_TTL_SEC = 4 * 60 * 60;
export const EXTERNAL_CLIENT_SESSION_TTL_SEC = 30 * 60;

export interface ClientIdentity {
  subject: string;
  kind: "operator" | "external";
  name?: string;
  email?: string;
  image?: string;
}

export interface ClientSession {
  identity: ClientIdentity;
  owner: string;
  repo: string;
  brandSlug: string;
  expiresAt: number;
}

interface MintClientSessionInput {
  identity: ClientIdentity;
  owner: string;
  repo: string;
  brandSlug: string;
}

function signingKey(): Uint8Array {
  const masterKey = process.env.KODY_MASTER_KEY;
  if (!masterKey) throw new Error("KODY_MASTER_KEY not configured");
  return new Uint8Array(
    hkdfSync(
      "sha256",
      Buffer.from(masterKey),
      Buffer.alloc(0),
      "kody-client-session:v1",
      32,
    ),
  );
}

function requiredString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength
    ? value
    : null;
}

export async function mintClientSession(
  input: MintClientSessionInput,
  options: { ttlSec?: number } = {},
): Promise<string> {
  const ttlSec = options.ttlSec ?? CLIENT_SESSION_TTL_SEC;
  return await new SignJWT({
    kind: input.identity.kind,
    name: input.identity.name,
    email: input.identity.email,
    image: input.identity.image,
    owner: input.owner,
    repo: input.repo,
    brandSlug: input.brandSlug,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.identity.subject)
    .setAudience("kody-brand-chat")
    .setIssuer("kody-dashboard")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSec)
    .sign(signingKey());
}

export async function verifyClientSession(
  token: string | null | undefined,
): Promise<ClientSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: ["HS256"],
      audience: "kody-brand-chat",
      issuer: "kody-dashboard",
    });
    const subject = requiredString(payload.sub, 300);
    const owner = requiredString(payload.owner, 100);
    const repo = requiredString(payload.repo, 100);
    const brandSlug = requiredString(payload.brandSlug, 80);
    const kind =
      payload.kind === "operator" || payload.kind === "external"
        ? payload.kind
        : null;
    if (!subject || !owner || !repo || !brandSlug || !kind || !payload.exp) {
      return null;
    }
    return {
      identity: {
        subject,
        kind,
        ...(requiredString(payload.name, 200)
          ? { name: payload.name as string }
          : {}),
        ...(requiredString(payload.email, 320)
          ? { email: payload.email as string }
          : {}),
        ...(requiredString(payload.image, 2048)
          ? { image: payload.image as string }
          : {}),
      },
      owner,
      repo,
      brandSlug,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}
