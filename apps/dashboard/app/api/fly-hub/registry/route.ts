import { NextRequest, NextResponse } from "next/server";
import { requireHubConfig, sameOrigin } from "@kody-ade/fly/hub/session";
import {
  readRegistrySession,
  setRegistrySession,
} from "@dashboard/lib/fly-hub-registry-session";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, private" };
export async function GET(req: NextRequest) {
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  return NextResponse.json(
    { user: readRegistrySession(req)?.user ?? null },
    { headers },
  );
}
export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => null);
  if (
    typeof body?.token !== "string" ||
    body.token.trim().length < 20 ||
    body.token.length > 255
  )
    return NextResponse.json(
      {
        error:
          "Enter a classic GitHub token with read:packages and write:packages.",
      },
      { status: 400 },
    );
  try {
    const token = body.token.trim();
    const result = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!result.ok) throw new Error("GitHub rejected this token.");
    const scopes =
      result.headers
        .get("x-oauth-scopes")
        ?.split(",")
        .map((s) => s.trim()) ?? [];
    if (!scopes.includes("write:packages"))
      throw new Error(
        "Use a classic GitHub token with write:packages permission.",
      );
    const user = (await result.json()).login as string;
    if (!/^[a-z0-9][a-z0-9-]{0,38}$/i.test(user))
      throw new Error("GitHub returned an invalid account.");
    const response = NextResponse.json({ user }, { headers });
    setRegistrySession(response, { user, token });
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not connect GitHub registry.",
      },
      { status: 400, headers },
    );
  }
}
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  const response = NextResponse.json({ user: null }, { headers });
  setRegistrySession(response, null);
  return response;
}
