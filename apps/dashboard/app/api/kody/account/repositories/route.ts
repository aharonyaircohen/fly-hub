import { NextRequest, NextResponse } from "next/server";
import {
  decrypt,
  encrypt,
  isVaultConfigured,
} from "@kody-ade/base/vault/crypto";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  ACCOUNT_REPOSITORY_CREDENTIAL_NAME,
  AccountRepositoryAuthSchema,
} from "@dashboard/lib/auth/account-repository-connections";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
function unavailable() {
  return NextResponse.json(
    { error: "credential_store_not_configured" },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export async function GET() {
  const user = await requireKodyUser();
  if (user instanceof NextResponse) return user;
  if (!isVaultConfigured()) return unavailable();

  const stored = await getConvexClient().query(backendApi.userCredentials.get, {
    userKey: user.id,
    name: ACCOUNT_REPOSITORY_CREDENTIAL_NAME,
  });
  if (!stored) {
    return NextResponse.json({ auth: null }, { headers: NO_STORE_HEADERS });
  }
  try {
    const auth = AccountRepositoryAuthSchema.parse(
      JSON.parse(decrypt(stored.encryptedValue)),
    );
    return NextResponse.json({ auth }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "repository_connections_invalid" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function PUT(req: NextRequest) {
  const user = await requireKodyUser();
  if (user instanceof NextResponse) return user;
  if (!isVaultConfigured()) return unavailable();
  const parsed = AccountRepositoryAuthSchema.safeParse(
    (await req.json().catch(() => null))?.auth,
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  await getConvexClient().mutation(backendApi.userCredentials.upsert, {
    userKey: user.id,
    name: ACCOUNT_REPOSITORY_CREDENTIAL_NAME,
    encryptedValue: encrypt(JSON.stringify(parsed.data)),
    updatedAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}

export async function DELETE() {
  const user = await requireKodyUser();
  if (user instanceof NextResponse) return user;
  await getConvexClient().mutation(backendApi.userCredentials.remove, {
    userKey: user.id,
    name: ACCOUNT_REPOSITORY_CREDENTIAL_NAME,
  });
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
