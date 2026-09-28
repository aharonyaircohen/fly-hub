import "server-only";

import { hkdfSync } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";

export const OPERATOR_SESSION_COOKIE = "kody_operator_session";
export const OPERATOR_SESSION_TTL_SEC = 30 * 24 * 60 * 60;

export interface OperatorIdentity {
  login: string;
  githubId: number;
  avatarUrl: string;
}

function signingKey(): Uint8Array {
  const masterKey = process.env.KODY_MASTER_KEY;
  if (!masterKey) throw new Error("KODY_MASTER_KEY not configured");
  return new Uint8Array(
    hkdfSync(
      "sha256",
      Buffer.from(masterKey),
      Buffer.alloc(0),
      "kody-operator-session:v1",
      32,
    ),
  );
}

export async function mintOperatorSession(
  identity: OperatorIdentity,
): Promise<string> {
  return await new SignJWT({
    login: identity.login,
    githubId: identity.githubId,
    avatarUrl: identity.avatarUrl,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(`github:${identity.githubId}`)
    .setAudience("kody-dashboard-operator")
    .setIssuer("kody-dashboard")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + OPERATOR_SESSION_TTL_SEC)
    .sign(signingKey());
}

export async function verifyOperatorSession(
  token: string | null | undefined,
): Promise<OperatorIdentity | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: ["HS256"],
      audience: "kody-dashboard-operator",
      issuer: "kody-dashboard",
    });
    if (
      typeof payload.login !== "string" ||
      !payload.login ||
      typeof payload.githubId !== "number" ||
      !Number.isSafeInteger(payload.githubId) ||
      typeof payload.avatarUrl !== "string"
    ) {
      return null;
    }
    return {
      login: payload.login,
      githubId: payload.githubId,
      avatarUrl: payload.avatarUrl,
    };
  } catch {
    return null;
  }
}

export async function operatorIdentityFromRequest(
  req: NextRequest,
): Promise<OperatorIdentity | null> {
  return await verifyOperatorSession(
    req.cookies.get(OPERATOR_SESSION_COOKIE)?.value,
  );
}

export function setOperatorSessionCookie(
  response: NextResponse,
  token: string,
): void {
  response.cookies.set(OPERATOR_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OPERATOR_SESSION_TTL_SEC,
  });
}

export function clearOperatorSessionCookie(response: NextResponse): void {
  response.cookies.set(OPERATOR_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
