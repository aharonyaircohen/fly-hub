/**
 * @fileType api-route
 * @domain user-state
 * @pattern user-state-api
 * @ai-summary GET: list the brand's user-state namespaces (name, version,
 *   origin, modelWritable) — the contract surface a future entities/triggers
 *   admin page reads. Schemas themselves are not serialized.
 */
import { NextRequest, NextResponse } from "next/server";
import { createUserOctokit } from "../../../../src/dashboard/lib/github-client";
import { resolveUnifiedActor } from "../../../../src/dashboard/lib/auth/unified-actor";
import { resolveBackgroundToken } from "@kody-ade/base/auth/background-token";
import { getUserStateNamespaces } from "../../../../src/dashboard/lib/user-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveUnifiedActor(req);
  if (!actor?.brand) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }
  const token =
    actor.token ??
    (await resolveBackgroundToken(actor.brand.owner, actor.brand.repo))?.token;
  if (!token) {
    return NextResponse.json(
      { message: "No repository access token available" },
      { status: 403 },
    );
  }

  const namespaces = await getUserStateNamespaces(
    createUserOctokit(token),
    actor.brand.owner,
    actor.brand.repo,
  );
  return NextResponse.json({
    namespaces: namespaces.map((ns) => ({
      name: ns.name,
      version: ns.version,
      origin: ns.origin,
      adapter: ns.adapter,
      merge: ns.merge,
      modelWritable: ns.modelWritable,
    })),
  });
}
