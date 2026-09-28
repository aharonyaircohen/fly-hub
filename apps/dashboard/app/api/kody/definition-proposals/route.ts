import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, verifyRepoReadAccess } from "@kody-ade/base/auth";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = await verifyRepoReadAccess(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json(
      { error: "missing repository identity" },
      { status: 401 },
    );
  const proposals = await createBackendClient().query(
    api.definitionProposals.list,
    {
      tenantId: `${auth.owner}/${auth.repo}`,
    },
  );
  return NextResponse.json({ proposals });
}
