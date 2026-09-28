/**
 * @fileType api-endpoint
 * @domain triggers
 * @pattern backend-crud-api
 * @ai-summary Deletes one trigger rule by id from `triggers/config.json`
 *   in the Kody backend. Admin only; audited.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { mutateTriggers } from "@kody-ade/base/triggers";
import { recordAudit } from "../../../../../src/dashboard/lib/activity/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const { auth, octokit } = access;

  const { id } = await context.params;
  let found = false;
  await mutateTriggers(octokit, auth.owner, auth.repo, (existing) => {
    const next = existing.filter((trigger) => trigger.id !== id);
    found = next.length !== existing.length;
    return next;
  });
  if (!found) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  recordAudit(req, { action: "trigger.delete", resource: id });
  return new NextResponse(null, { status: 204 });
}
