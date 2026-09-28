import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRepoWriteAccess } from "@kody-ade/base/auth";
import {
  createApprovalDecisionDependencies,
  decideMcpApprovalRequest,
} from "@dashboard/lib/mcp/approval-service";

const requestIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const parsedId = requestIdSchema.safeParse((await params).requestId);
  const parsedBody = decisionSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsedId.success || !parsedBody.success)
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    const result = await decideMcpApprovalRequest(
      {
        tenantId: `${access.auth.owner}/${access.auth.repo}`,
        requestId: parsedId.data,
        decision: parsedBody.data.decision,
        decidedBy: `github:${access.actorGithubId}`,
      },
      createApprovalDecisionDependencies({ origin: req.nextUrl.origin }),
    );
    return NextResponse.json(result, {
      status: result.status === "dispatched" ? 202 : 200,
    });
  } catch (error) {
    const unavailable =
      error instanceof Error &&
      error.message === "Approval request is unavailable";
    return NextResponse.json(
      {
        error: unavailable ? "approval_unavailable" : "approval_failed",
        message: unavailable
          ? "Approval request is unavailable."
          : "Kody could not apply this decision.",
      },
      { status: unavailable ? 409 : 500 },
    );
  }
}
