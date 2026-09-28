import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, verifyRepoReadAccess } from "@kody-ade/base/auth";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function readLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = await verifyRepoReadAccess(req);
  if (authError instanceof NextResponse) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json(
      { error: "missing repository identity" },
      { status: 401 },
    );
  }

  const events = await createBackendClient().query(
    api.workflowEventDeliveries.recent,
    {
      tenantId: `${auth.owner}/${auth.repo}`,
      limit: readLimit(req.nextUrl.searchParams.get("limit")),
    },
  );

  return NextResponse.json({
    events,
    total: events.length,
    computedAt: new Date().toISOString(),
  });
}
