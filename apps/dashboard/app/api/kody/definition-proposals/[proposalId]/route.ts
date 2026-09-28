import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth, verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

export const dynamic = "force-dynamic";

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ proposalId: string }> },
): Promise<NextResponse> {
  const authError = await verifyRepoWriteAccess(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json(
      { error: "missing repository identity" },
      { status: 401 },
    );
  const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid decision" }, { status: 400 });
  const { proposalId } = await params;
  try {
    const result = await createBackendClient().mutation(
      api.definitionProposals.decide,
      {
        tenantId: `${auth.owner}/${auth.repo}`,
        proposalId,
        decision: parsed.data.decision,
        decidedAt: new Date().toISOString(),
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "proposal decision failed",
      },
      { status: 409 },
    );
  }
}
