/**
 * @fileType api-endpoint
 * @domain snippets
 * @pattern backend-crud-api
 * @ai-summary Lists and upserts brand snippets stored at
 *   `snippets/config.json` in the Kody backend. Admin (operator PAT)
 *   only; mutations are audited.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@kody-ade/base/auth";
import { recordAudit } from "../../../../src/dashboard/lib/activity/audit";
import { getSnippets, mutateSnippets } from "../../../../src/dashboard/lib/snippets/store";
import { snippetConfigSchema } from "../../../../src/dashboard/lib/snippets/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const saveSchema = z.object({ snippet: snippetConfigSchema });

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  const octokit = await getUserOctokit(req);
  if (!auth || !octokit) {
    return NextResponse.json(
      { error: "missing_repo_context" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  const snippets = await getSnippets(octokit, auth.owner, auth.repo, {
    cache: false,
  });
  return NextResponse.json({ snippets }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  const octokit = await getUserOctokit(req);
  if (!auth || !octokit) {
    return NextResponse.json(
      { error: "missing_repo_context" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  let snippet: z.infer<typeof saveSchema>["snippet"];
  try {
    snippet = saveSchema.parse(await req.json()).snippet;
  } catch (error) {
    return NextResponse.json(
      { error: "invalid_snippet", detail: String(error) },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  await mutateSnippets(octokit, auth.owner, auth.repo, (existing) => [
    ...existing.filter((candidate) => candidate.id !== snippet.id),
    snippet,
  ]);
  recordAudit(req, {
    action: "snippet.save",
    resource: snippet.id,
    detail: `${snippet.placement} · ${snippet.name}`,
  });
  return NextResponse.json({ snippet }, { headers: NO_STORE_HEADERS });
}
