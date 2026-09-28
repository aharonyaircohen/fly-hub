import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { encrypt, isVaultConfigured } from "@kody-ade/base/vault/crypto";
import { readVault } from "@kody-ade/base/vault/store";
import { logger } from "@kody-ade/base/logger";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";

const ImportSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
});

export async function POST(request: NextRequest) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;
  if (!isVaultConfigured()) {
    return NextResponse.json(
      { error: "credential_store_not_configured" },
      { status: 503 },
    );
  }

  const parsed = ImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }

  const access = await verifyRepoWriteAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    const { doc } = await readVault(
      access.octokit,
      access.auth.owner,
      access.auth.repo,
    );
    const credential = doc.secrets[parsed.data.name];
    if (!credential?.value) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const updatedAt = new Date().toISOString();
    await getConvexClient().mutation(backendApi.userCredentials.upsert, {
      userKey: actor.id,
      name: parsed.data.name,
      encryptedValue: encrypt(credential.value),
      updatedAt,
    });
    return NextResponse.json({ ok: true, name: parsed.data.name, updatedAt });
  } catch (error) {
    logger.error(
      {
        error,
        userId: actor.id,
        owner: access.auth.owner,
        repo: access.auth.repo,
        name: parsed.data.name,
      },
      "personal credential import failed",
    );
    return NextResponse.json({ error: "credential_import_failed" }, { status: 500 });
  }
}
