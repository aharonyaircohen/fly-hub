import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readHubSession, sameOrigin } from "@kody-ade/fly/hub/session";
import { issueFlyHubMcpGrant } from "@dashboard/lib/fly-hub-mcp-auth";

export const runtime = "nodejs";

const bodySchema = z.object({
  scopes: z.array(z.enum(["read", "manage", "command"])).min(1).max(3),
}).strict();

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const session = readHubSession(req);
  if (!session) return NextResponse.json({ error: "fly_sign_in_required" }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_scopes" }, { status: 400 });
  const grant = issueFlyHubMcpGrant({
    token: session.token,
    orgSlug: session.orgSlug,
    scopes: [...new Set(body.data.scopes)],
  });
  return NextResponse.json(grant, { headers: { "Cache-Control": "no-store, private" } });
}
