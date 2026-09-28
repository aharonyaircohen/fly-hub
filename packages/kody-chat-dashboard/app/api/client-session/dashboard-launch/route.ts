/**
 * Converts a verified Dashboard operator into Brand Chat's internal session.
 * The PAT never leaves Dashboard auth headers and the session token never
 * reaches browser JavaScript.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestAuth, verifyActorLogin } from "@kody-ade/base/auth";
import { resolveClientBrand } from "../../../../src/dashboard/lib/client-brand";
import { mintClientSession } from "../../../../src/dashboard/lib/client-session/session";
import { setClientSessionCookie } from "../../../../src/dashboard/lib/client-session/cookie";

export const runtime = "nodejs";

const launchSchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
  repo: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
  brandSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
});

export async function POST(req: NextRequest) {
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json(
      { error: "request_auth_required" },
      { status: 401 },
    );
  }

  const parsed = launchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_launch_request" },
      { status: 400 },
    );
  }
  const { owner, repo, brandSlug } = parsed.data;
  if (auth.owner !== owner || auth.repo !== repo) {
    return NextResponse.json({ error: "repository_mismatch" }, { status: 403 });
  }

  const actor = await verifyActorLogin(req, auth.userLogin);
  if (actor instanceof NextResponse) return actor;

  let brand;
  try {
    brand = await resolveClientBrand(brandSlug, {
      owner,
      repo,
      token: auth.token,
      storeRepoUrl: auth.storeRepoUrl,
      storeRef: auth.storeRef,
    });
  } catch {
    return NextResponse.json({ error: "brand_unavailable" }, { status: 503 });
  }
  if (!brand) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }
  if (brand.access.mode !== "delegated") {
    return NextResponse.json(
      { error: "brand_does_not_require_delegated_access" },
      { status: 409 },
    );
  }

  const token = await mintClientSession({
    identity: {
      subject: `github:${actor.identity.githubId}`,
      kind: "operator",
      name: actor.identity.login,
      image: actor.identity.avatar_url,
    },
    owner,
    repo,
    brandSlug: brand.slug,
  });
  const url = `/client/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(brand.slug)}`;
  const response = NextResponse.json({ url });
  setClientSessionCookie(response, token);
  return response;
}
