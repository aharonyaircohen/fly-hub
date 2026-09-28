import "server-only";

import type { NextRequest, NextResponse } from "next/server";

export const GUIDED_FLOW_BOOTSTRAP_COOKIE = "kody_guided_flow_bootstrap";

const BOOTSTRAP_TTL_SECONDS = 30 * 24 * 60 * 60;
const BOOTSTRAP_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface GuidedFlowBootstrapScope {
  readonly id: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly created: boolean;
}

function scopeForId(id: string, created: boolean): GuidedFlowBootstrapScope {
  return {
    id,
    tenantId: `bootstrap/${id}`,
    actorId: `bootstrap:${id}`,
    created,
  };
}

export function readGuidedFlowBootstrapScope(
  request: NextRequest,
): GuidedFlowBootstrapScope | null {
  const id = request.cookies.get(GUIDED_FLOW_BOOTSTRAP_COOKIE)?.value;
  return id && BOOTSTRAP_ID_PATTERN.test(id) ? scopeForId(id, false) : null;
}

export function createGuidedFlowBootstrapScope(): GuidedFlowBootstrapScope {
  return scopeForId(crypto.randomUUID(), true);
}

export function setGuidedFlowBootstrapCookie(
  response: NextResponse,
  scope: GuidedFlowBootstrapScope,
): void {
  if (!scope.created) return;
  response.cookies.set(GUIDED_FLOW_BOOTSTRAP_COOKIE, scope.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: BOOTSTRAP_TTL_SECONDS,
  });
}
