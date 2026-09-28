import { NextRequest, NextResponse } from "next/server";
import {
  getRequestAuth,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { getSecret } from "@kody-ade/base/vault/get-secret";
import { logger } from "@kody-ade/base/logger";
import { connectionAfterVerification } from "@dashboard/lib/connections/model";
import {
  readConnection,
  writeConnection,
} from "@dashboard/lib/connections/store";
import { verifyConnection } from "@dashboard/lib/connections/verification";
import { connectionProvider } from "@dashboard/lib/connections/providers";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const actor = await verifyActorLogin(req, undefined);
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  try {
    const connection = await readConnection(auth.owner, auth.repo, id);
    if (!connection) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (connection.status === "disabled") {
      return NextResponse.json({ error: "connection_disabled" }, { status: 409 });
    }
    if (!connectionProvider(connection.provider, connection.accountType)) {
      return NextResponse.json({ error: "unsupported_connection" }, { status: 400 });
    }
    const accessToken = await getSecret(connection.credentialRefs.accessToken, {
      req,
      vaultOnly: true,
    });
    if (!accessToken) {
      const updated = connectionAfterVerification(connection, { ok: false });
      await writeConnection(auth.owner, auth.repo, updated);
      return NextResponse.json(
        { ok: false, connection: updated, error: "credential_missing" },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    const result = await verifyConnection(connection, accessToken);
    const updated = connectionAfterVerification(
      connection,
      result.ok
        ? { ok: true, verifiedAt: new Date().toISOString() }
        : { ok: false },
    );
    await writeConnection(auth.owner, auth.repo, updated);
    return NextResponse.json(
      result.ok
        ? { ok: true, connection: updated, externalName: result.externalName }
        : { ok: false, connection: updated, error: result.reason },
      { status: result.ok ? 200 : 409, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    logger.error(
      { error, owner: auth.owner, repo: auth.repo, connectionId: id },
      "connections: verification failed",
    );
    return NextResponse.json(
      { error: "connection_verification_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
