import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { encrypt, isVaultConfigured } from "@kody-ade/base/vault/crypto";
import { logger } from "@kody-ade/base/logger";
import { isInternalKodyCredential } from "@kody-ade/base/auth/internal-credentials";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const CredentialSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
  value: z
    .string()
    .min(1)
    .max(64 * 1024),
});

function unconfigured() {
  return NextResponse.json(
    { error: "credential_store_not_configured" },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export async function GET(_req?: NextRequest) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;
  if (!isVaultConfigured()) return unconfigured();

  try {
    const credentials = await getConvexClient().query(
      backendApi.userCredentials.list,
      { userKey: actor.id },
    );
    return NextResponse.json(
      {
        credentials: credentials.filter(
          (credential) => !isInternalKodyCredential(credential.name),
        ),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    logger.error(
      { error, userId: actor.id },
      "personal credentials: list failed",
    );
    return NextResponse.json(
      { error: "credentials_read_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function PUT(req: NextRequest) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;
  if (!isVaultConfigured()) return unconfigured();

  const parsed = CredentialSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const updatedAt = new Date().toISOString();
  try {
    await getConvexClient().mutation(backendApi.userCredentials.upsert, {
      userKey: actor.id,
      name: parsed.data.name,
      encryptedValue: encrypt(parsed.data.value),
      updatedAt,
    });
    return NextResponse.json({ ok: true, name: parsed.data.name, updatedAt });
  } catch (error) {
    logger.error(
      { error, userId: actor.id, name: parsed.data.name },
      "personal credentials: write failed",
    );
    return NextResponse.json(
      { error: "credentials_write_failed" },
      { status: 500 },
    );
  }
}
