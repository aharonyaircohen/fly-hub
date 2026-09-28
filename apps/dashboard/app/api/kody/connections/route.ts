import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { logger } from "@kody-ade/base/logger";
import {
  SaveConnectionSchema,
  connectionAfterSave,
} from "@dashboard/lib/connections/model";
import {
  listConnections,
  readConnection,
  writeConnection,
} from "@dashboard/lib/connections/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const requestSchema = SaveConnectionSchema.extend({
  actorLogin: z.string().optional(),
}).strict();

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      { connections: await listConnections(auth.owner, auth.repo) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    logger.error(
      { error, owner: auth.owner, repo: auth.repo },
      "connections: list failed",
    );
    return NextResponse.json(
      { error: "connections_read_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  const actor = await verifyActorLogin(req, parsed.data.actorLogin);
  if (actor instanceof NextResponse) return actor;
  try {
    const current = await readConnection(auth.owner, auth.repo, parsed.data.id);
    const connection = connectionAfterSave(current, parsed.data);
    await writeConnection(auth.owner, auth.repo, connection);
    return NextResponse.json({ ok: true, connection }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    logger.error(
      { error, owner: auth.owner, repo: auth.repo, connectionId: parsed.data.id },
      "connections: save failed",
    );
    return NextResponse.json(
      { error: "connection_save_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
