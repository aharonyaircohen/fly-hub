/**
 * @fileType api-endpoint
 * @domain runner
 * @pattern fly-config-status-api
 *
 * Reports whether this repo has its own Fly token. A server-wide environment
 * token is intentionally excluded, and the credential never crosses the
 * server boundary.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth } from "@kody-ade/base/auth";
import { resolveServerProviderContext } from "../infrastructure/server-context";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const ctx = await resolveServerProviderContext(req);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  return NextResponse.json({
    configured: Boolean(ctx.context.flyToken),
    source: ctx.context.providerTokenSource,
  });
}
