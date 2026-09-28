import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth } from "@kody-ade/base/auth";
import { userTenantIdFor } from "@dashboard/lib/backend/convex-backend";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";

export type ConversationRequestContext = Readonly<{
  owner?: string;
  repo?: string;
  tenantId: string;
  actorLogin: string;
  actorId: string;
}>;

export async function requireConversationContext(
  req: NextRequest,
): Promise<ConversationRequestContext | NextResponse> {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;
  const auth = getRequestAuth(req);
  return {
    ...(auth ? { owner: auth.owner, repo: auth.repo } : {}),
    tenantId: userTenantIdFor(actor.id),
    actorLogin: actor.label,
    actorId: actor.id,
  };
}

export function invalidBody(issues: unknown): NextResponse {
  return NextResponse.json({ error: "invalid_body", issues }, { status: 400 });
}
