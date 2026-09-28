import { NextRequest, NextResponse } from "next/server";
import { decrypt, isVaultConfigured } from "@kody-ade/base/vault/crypto";
import { resolveKodyRequestScope } from "@dashboard/lib/auth/kody-request-scope";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";
import { verifyRepoWriteAccess, getRequestAuth } from "@kody-ade/base/auth";
import { isInternalKodyCredential } from "@kody-ade/base/auth/internal-credentials";
import { readVault } from "@kody-ade/base/vault/store";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  if (!isVaultConfigured())
    return NextResponse.json(
      { error: "vault_not_configured" },
      { status: 503 },
    );
  const { name } = await params;
  if (isInternalKodyCredential(name)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (getRequestAuth(req)) {
    const access = await verifyRepoWriteAccess(req);
    if (access instanceof NextResponse) return access;
    const { doc } = await readVault(
      access.octokit,
      access.auth.owner,
      access.auth.repo,
    );
    const entry = doc.secrets[name];
    return entry
      ? NextResponse.json({
          name,
          value: entry.value,
          updatedAt: entry.updatedAt,
          updatedBy: entry.updatedBy ?? null,
        })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  const stored = await getConvexClient().query(backendApi.userCredentials.get, {
    userKey: resolved.user.id,
    name,
  });
  if (!stored)
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    name,
    value: decrypt(stored.encryptedValue),
    updatedAt: stored.updatedAt,
  });
}
