import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { encrypt, isVaultConfigured } from "@kody-ade/base/vault/crypto";
import { isInternalKodyCredential } from "@kody-ade/base/auth/internal-credentials";
import {
  getRequestAuth,
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
} from "@kody-ade/base/auth";
import { listSecretMetadata, readVault } from "@kody-ade/base/vault/store";
import { upsertSecret } from "@kody-ade/base/vault/mutations";
import { resolveKodyRequestScope } from "@dashboard/lib/auth/kody-request-scope";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const schema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
  value: z
    .string()
    .min(1)
    .max(64 * 1024),
});

function unavailable() {
  return NextResponse.json(
    { error: "vault_not_configured" },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export async function GET(req: NextRequest) {
  const repository = getRequestAuth(req);
  if (repository) {
    const access = await verifyRepoReadAccess(req);
    if (access instanceof NextResponse) return access;
    if (!isVaultConfigured()) return unavailable();
    const { doc } = await readVault(
      access.octokit,
      access.auth.owner,
      access.auth.repo,
    );
    return NextResponse.json(
      { secrets: listSecretMetadata(doc) },
      { headers: NO_STORE_HEADERS },
    );
  }
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  if (!isVaultConfigured()) return unavailable();
  const secrets = await getConvexClient().query(
    backendApi.userCredentials.list,
    {
      userKey: resolved.user.id,
    },
  );
  return NextResponse.json(
    {
      secrets: secrets.filter(
        (secret) => !isInternalKodyCredential(secret.name),
      ),
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(req: NextRequest) {
  const repository = getRequestAuth(req);
  if (repository) {
    const access = await verifyRepoWriteAccess(req);
    if (access instanceof NextResponse) return access;
    if (!isVaultConfigured()) return unavailable();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "validation_error" }, { status: 400 });
    const result = await upsertSecret({
      octokit: access.octokit,
      owner: access.auth.owner,
      repo: access.auth.repo,
      name: parsed.data.name,
      value: parsed.data.value,
      actorLogin: access.actorLogin,
    });
    return NextResponse.json({ ok: true, secrets: result.secrets });
  }
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;
  if (!isVaultConfigured()) return unavailable();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  const updatedAt = new Date().toISOString();
  await getConvexClient().mutation(backendApi.userCredentials.upsert, {
    userKey: resolved.user.id,
    name: parsed.data.name,
    encryptedValue: encrypt(parsed.data.value),
    updatedAt,
  });
  const secrets = await getConvexClient().query(
    backendApi.userCredentials.list,
    {
      userKey: resolved.user.id,
    },
  );
  return NextResponse.json({
    ok: true,
    secrets: secrets.filter((secret) => !isInternalKodyCredential(secret.name)),
  });
}
