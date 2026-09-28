/**
 * @fileType api-endpoint
 * @domain snippets
 * @pattern backend-crud-api
 * @ai-summary Deletes one brand snippet by id from `snippets/config.json`
 *   in the Kody backend. Admin only; audited.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@kody-ade/base/auth";
import { recordAudit } from "../../../../../src/dashboard/lib/activity/audit";
import { mutateSnippets } from "../../../../../src/dashboard/lib/snippets/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  const octokit = await getUserOctokit(req);
  if (!auth || !octokit) {
    return NextResponse.json(
      { error: "missing_repo_context" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const { id } = await context.params;
  let found = false;
  await mutateSnippets(octokit, auth.owner, auth.repo, (existing) => {
    const next = existing.filter((snippet) => snippet.id !== id);
    found = next.length !== existing.length;
    return next;
  });
  if (!found) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  recordAudit(req, { action: "snippet.delete", resource: id });
  return new NextResponse(null, { status: 204 });
}
