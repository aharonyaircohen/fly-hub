import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth, verifyRepoReadAccess } from "@kody-ade/base/auth";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { isPipelineDefinitionId } from "@dashboard/lib/pipeline-definitions";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await verifyRepoReadAccess(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  const { id } = await params;
  if (!isPipelineDefinitionId(id))
    return NextResponse.json({ error: "invalid_pipeline_id" }, { status: 400 });
  const runs = await createBackendClient().query(api.pipelineRuns.list, {
    tenantId: `${auth.owner}/${auth.repo}`,
    pipelineId: id,
    limit: 50,
  });
  return NextResponse.json(
    { runs },
    { headers: { "Cache-Control": "no-store" } },
  );
}
