import { NextRequest, NextResponse } from "next/server";
import { isVaultConfigured } from "@kody-ade/base/vault/crypto";
import { ConfigNameSchema } from "@kody-ade/base/variables/mutations";
import { getRequestAuth, verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { deleteSecret } from "@kody-ade/base/vault/mutations";
import { resolveKodyRequestScope } from "@dashboard/lib/auth/kody-request-scope";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  if (!isVaultConfigured())
    return NextResponse.json(
      { error: "vault_not_configured" },
      { status: 503 },
    );
  const { name } = await params;
  if (!ConfigNameSchema.safeParse(name).success)
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  const repository = getRequestAuth(req);
  if (repository) {
    const access = await verifyRepoWriteAccess(req);
    if (access instanceof NextResponse) return access;
    const result = await deleteSecret({
      octokit: access.octokit,
      owner: access.auth.owner,
      repo: access.auth.repo,
      name,
    });
    return result.found
      ? NextResponse.json({ ok: true, secrets: result.secrets })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  const existing = await getConvexClient().query(
    backendApi.userCredentials.get,
    {
      userKey: resolved.user.id,
      name,
    },
  );
  if (!existing)
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  await getConvexClient().mutation(backendApi.userCredentials.remove, {
    userKey: resolved.user.id,
    name,
  });
  const secrets = await getConvexClient().query(
    backendApi.userCredentials.list,
    {
      userKey: resolved.user.id,
    },
  );
  return NextResponse.json({ ok: true, secrets });
}
