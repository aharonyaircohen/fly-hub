/**
 * @fileType api-endpoint
 * @domain variables
 * @pattern variables-api
 * @ai-summary DELETE /api/kody/variables/[name] — remove a variable.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@kody-ade/base/auth";
import {
  ConfigNameSchema,
  RESERVED_VARIABLE_NAMES,
  deleteVariable,
} from "@kody-ade/base/variables/mutations";
import { logger } from "@kody-ade/base/logger";

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const { name } = await context.params;
  if (!name || !ConfigNameSchema.safeParse(name).success) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }
  if (RESERVED_VARIABLE_NAMES.has(name)) {
    return NextResponse.json({ error: "reserved_name" }, { status: 400 });
  }

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  try {
    const result = await deleteVariable({
      owner: auth.owner,
      repo: auth.repo,
      name,
    });
    if (!result.found) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, variables: result.variables });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo, name },
      "variables: delete failed",
    );
    return NextResponse.json(
      { error: "variables_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
