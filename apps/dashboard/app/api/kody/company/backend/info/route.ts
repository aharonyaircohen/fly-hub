/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern backend-info
 * @ai-summary GET /api/kody/company/backend/info — which Convex deployment
 *   this dashboard instance is connected to, and where it runs (local dev vs
 *   Vercel production). Powers the /backend "Connected backend" card so an
 *   operator can always tell which world they are looking at.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth } from "@kody-ade/base/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const convexUrl = process.env.CONVEX_URL?.trim() || null;
  const host = convexUrl ? new URL(convexUrl).host : null;
  // Convex writes CONVEX_DEPLOYMENT as "<tier>:<name>" (e.g. "dev:animated-
  // sardine-218", "prod:aware-raccoon-432") — the authoritative dev/prod
  // signal for the DATABASE, independent of where this server runs.
  const deployment = process.env.CONVEX_DEPLOYMENT?.trim() ?? "";
  const databaseTier = deployment.includes(":")
    ? deployment.split(":", 1)[0]
    : null;
  // "production" | "preview" | "development" on Vercel; local dev has none.
  const runtimeEnv = process.env.VERCEL_ENV ?? "local";

  return NextResponse.json({
    convexHost: host,
    configured: Boolean(convexUrl),
    databaseTier,
    runtimeEnv,
  });
}
