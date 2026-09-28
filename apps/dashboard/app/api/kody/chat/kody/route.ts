/**
 * Dashboard route boundary for the package-owned Kody chat endpoint.
 *
 * Keep Next.js segment settings here because they cannot be re-exported.
 */
import "./dashboard-host-tools";
import "./dashboard-feature-guides";
import { NextRequest, NextResponse } from "next/server";
import { POST as packagePost } from "@kody-ade/kody-chat-dashboard/routes/kody/chat-kody";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import { resolveSurfaceScope } from "@kody-ade/kody-chat-dashboard/platform/surface-scope";
import "@dashboard/lib/chat/personal-model-settings";

export async function POST(request: NextRequest) {
  // Protected Brand users carry a narrowly scoped surface ticket instead of
  // a Dashboard account. The package route validates and restricts it.
  if (resolveSurfaceScope(request.headers).kind !== "client") {
    const actor = await requireKodyUser();
    if (actor instanceof NextResponse) return actor;
  }
  return packagePost(request);
}

export const runtime = "nodejs";
export const maxDuration = 800;
