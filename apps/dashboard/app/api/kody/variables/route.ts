/**
 * @fileType api-endpoint
 * @domain variables
 * @pattern variables-api
 * @ai-summary GET — list all variables (name, value, meta). POST — upsert
 *   a variable { name, value }. Unlike secrets, values are returned because
 *   variables are non-sensitive config (model lists, feature flags, etc).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@kody-ade/base/auth";
import { listVariables, readVariables } from "@kody-ade/base/variables/store";
import {
  VariableWriteSchema,
  upsertVariable,
} from "@kody-ade/base/variables/mutations";
import { logger } from "@kody-ade/base/logger";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json(
      { error: "no_repo_context" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json(
      { error: "no_octokit" },
      { status: 401, headers: NO_STORE_HEADERS },
    );

  try {
    const { doc } = await readVariables(auth.owner, auth.repo);
    return NextResponse.json(
      { variables: listVariables(doc) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "variables: list failed",
    );
    return NextResponse.json(
      { error: "variables_read_failed", message: (err as Error).message },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = VariableWriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const verify = await verifyActorLogin(req, parsed.data.actorLogin);
  if ("status" in verify) return verify;
  const actorLogin = verify.identity.login;

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  try {
    const { doc } = await upsertVariable({
      owner: auth.owner,
      repo: auth.repo,
      name: parsed.data.name,
      value: parsed.data.value,
      actorLogin,
    });
    return NextResponse.json({ ok: true, variables: listVariables(doc) });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo, name: parsed.data.name },
      "variables: upsert failed",
    );
    return NextResponse.json(
      { error: "variables_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
