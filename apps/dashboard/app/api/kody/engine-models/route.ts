/** Repository-owned Engine model settings used by the legacy shared Models UI. */
import { NextRequest, NextResponse } from "next/server";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import {
  ModelsWriteSchema,
  readManagedAutomaticModel,
  readManagedChatModels,
  saveManagedChatModels,
} from "@kody-ade/base/variables/mutations";
import { readVariables } from "@kody-ade/base/variables/store";
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
  if (!(await getUserOctokit(req))) {
    return NextResponse.json(
      { error: "no_octokit" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const { doc } = await readVariables(auth.owner, auth.repo);
    return NextResponse.json(
      {
        models: readManagedChatModels(doc),
        automatic: readManagedAutomaticModel(doc),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    logger.error(
      { error, owner: auth.owner, repo: auth.repo },
      "engine models: list failed",
    );
    return NextResponse.json(
      { error: "engine_models_read_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) return NextResponse.json({ error: "no_repo_context" }, { status: 400 });

  const octokit = await getUserOctokit(req);
  if (!octokit) return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  const parsed = ModelsWriteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const verify = await verifyActorLogin(req, parsed.data.actorLogin);
  if ("status" in verify) return verify;

  try {
    const result = await saveManagedChatModels({
      octokit,
      owner: auth.owner,
      repo: auth.repo,
      models: parsed.data.models,
      automatic: parsed.data.automatic,
      actorLogin: verify.identity.login,
    });
    return NextResponse.json({
      ok: true,
      models: result.models,
      automatic: parsed.data.automatic,
      ...(result.engineSyncWarning
        ? { engineSyncWarning: result.engineSyncWarning }
        : {}),
    });
  } catch (error) {
    logger.error(
      { error, owner: auth.owner, repo: auth.repo },
      "engine models: write failed",
    );
    return NextResponse.json(
      { error: "engine_models_write_failed", message: (error as Error).message },
      { status: 500 },
    );
  }
}
