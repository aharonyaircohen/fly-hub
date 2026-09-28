import { NextRequest, NextResponse } from "next/server";
import {
  clearHubSession,
  flyOrganizations,
  readHubSession,
  sameOrigin,
  setHubSession,
} from "@kody-ade/fly/hub/session";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "no-store, private" };

export async function GET(req: NextRequest) {
  const session = readHubSession(req);
  return NextResponse.json(
    { connected: !!session, orgSlug: session?.orgSlug ?? null },
    { headers: privateHeaders },
  );
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 4096) {
    return NextResponse.json({ error: "Enter a Fly token." }, { status: 400 });
  }
  try {
    const orgs = await flyOrganizations(token);
    const response = NextResponse.json(
      { connected: true, orgSlug: orgs[0], organizations: orgs },
      { headers: privateHeaders },
    );
    setHubSession(response, { token, orgSlug: orgs[0]! });
    return response;
  } catch {
    return NextResponse.json(
      { error: "Fly could not verify this token. Check it and try again." },
      { status: 401, headers: privateHeaders },
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const response = NextResponse.json({ connected: false }, { headers: privateHeaders });
  clearHubSession(response);
  return response;
}
