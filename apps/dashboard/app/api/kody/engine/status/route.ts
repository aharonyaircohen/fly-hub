import { NextRequest, NextResponse } from "next/server";
import { getRequestAuth } from "@kody-ade/base/auth";

import { getEngineSetupStatus } from "@dashboard/lib/engine/status";
import { createUserOctokit } from "@dashboard/lib/github-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  }

  const status = await getEngineSetupStatus({
    octokit: createUserOctokit(auth.token),
    owner: auth.owner,
    repo: auth.repo,
  });
  return NextResponse.json(status, {
    status: 200,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
