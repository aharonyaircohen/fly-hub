import { NextRequest, NextResponse } from "next/server";
import { decrypt, encrypt } from "@kody-ade/base/vault/crypto";
import type { FlyPreviewConfig } from "../plugin/previews/machines-client";

const COOKIE = "fly_hub_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

interface HubSession {
  token: string;
  orgSlug: string;
  expiresAt: number;
}

export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const source = new URL(origin);
    const host = req.headers.get("host");
    const protocol = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.slice(0, -1);
    return source.host === host && source.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

export async function flyOrganizations(token: string): Promise<string[]> {
  const response = await fetch("https://api.fly.io/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "query { organizations { nodes { slug } } }" }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Fly rejected this token.");
  const result = (await response.json()) as {
    data?: { organizations?: { nodes?: Array<{ slug?: string }> } };
    errors?: Array<{ message?: string }>;
  };
  if (result.errors?.length) throw new Error("Fly rejected this token.");
  const slugs = result.data?.organizations?.nodes
    ?.map((node) => node.slug)
    .filter((slug): slug is string => !!slug && /^[a-z0-9-]+$/.test(slug));
  if (!slugs?.length) throw new Error("This token cannot access a Fly organization.");
  return slugs;
}

export function setHubSession(
  response: NextResponse,
  input: { token: string; orgSlug: string },
): void {
  const session: HubSession = {
    ...input,
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
  };
  response.cookies.set(COOKIE, encrypt(JSON.stringify(session)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export function clearHubSession(response: NextResponse): void {
  response.cookies.set(COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export function readHubSession(req: NextRequest): HubSession | null {
  const payload = req.cookies.get(COOKIE)?.value;
  if (!payload) return null;
  try {
    const parsed = JSON.parse(decrypt(payload)) as Partial<HubSession>;
    if (
      typeof parsed.token !== "string" ||
      !parsed.token ||
      typeof parsed.orgSlug !== "string" ||
      !/^[a-z0-9-]+$/.test(parsed.orgSlug) ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) return null;
    return parsed as HubSession;
  } catch {
    return null;
  }
}

export function hubConfig(req: NextRequest): FlyPreviewConfig | null {
  const session = readHubSession(req);
  return session
    ? { token: session.token, orgSlug: session.orgSlug, defaultRegion: "iad" }
    : null;
}

export function requireHubConfig(req: NextRequest):
  | { cfg: FlyPreviewConfig }
  | { response: NextResponse } {
  const cfg = hubConfig(req);
  return cfg
    ? { cfg }
    : { response: NextResponse.json({ error: "fly_sign_in_required" }, { status: 401 }) };
}
