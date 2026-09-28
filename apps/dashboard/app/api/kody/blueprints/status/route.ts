import { NextRequest, NextResponse } from "next/server";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { getRequestAuth, verifyRepoReadAccess } from "@kody-ade/base/auth";
import {
  getOctokit,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { listStoreCatalogSlugs } from "@dashboard/lib/store-catalog-index";
import { readStoreStrategy } from "@dashboard/lib/store-strategies";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const authError = await verifyRepoReadAccess(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });

  setGitHubContext(
    auth.owner,
    auth.repo,
    auth.token,
    auth.storeRepoUrl,
    auth.storeRef,
  );
  try {
    const octokit = getOctokit();
    const [{ strategies }, installations] = await Promise.all([
      listStoreCatalogSlugs(octokit),
      createBackendClient().query(backendApi.blueprintInstallations.list, {
        tenantId: `${auth.owner}/${auth.repo}`,
      }),
    ]);
    const byId = new Map(installations.map((item) => [item.blueprintId, item]));
    const records = await Promise.all(
      strategies.map(async (id) => {
        const record = await readStoreStrategy(octokit, id);
        if (!record) return null;
        const installation = byId.get(id);
        return {
          id,
          name: record.blueprint.name,
          version: record.blueprint.version,
          status: installation?.status ?? "not_installed",
          ...(installation?.requestId
            ? { requestId: installation.requestId }
            : {}),
          ...(installation?.maintainerId
            ? { maintainerId: installation.maintainerId }
            : {}),
          evidence: installation?.evidence ?? [],
          updatedAt: installation?.updatedAt ?? null,
        };
      }),
    );
    return NextResponse.json(
      { blueprints: records.filter(Boolean) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearGitHubContext();
  }
}
