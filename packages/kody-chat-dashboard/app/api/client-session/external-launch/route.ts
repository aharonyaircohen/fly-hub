/**
 * Exchanges a trusted host's short-lived assertion for Chat's own session.
 * Provider-specific login never enters the Chat domain.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveClientBrand } from "../../../../src/dashboard/lib/client-brand";
import {
  resolveExternalIdentityConfig,
  verifyExternalLaunchAssertion,
} from "../../../../src/dashboard/lib/client-session/external-identity";
import { setClientSessionCookie } from "../../../../src/dashboard/lib/client-session/cookie";
import {
  EXTERNAL_CLIENT_SESSION_TTL_SEC,
  mintClientSession,
} from "../../../../src/dashboard/lib/client-session/session";
import { checkExternalLaunchRateLimit } from "../../../../src/dashboard/lib/client-session/rate-limit";

export const runtime = "nodejs";

const launchSchema = z.object({
  assertion: z.string().min(20).max(16_384),
  owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
  repo: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
  brandSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
});

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "form_post_required" }, { status: 415 });
  }
  const form = await req.formData().catch(() => null);
  const parsed = launchSchema.safeParse(
    form
      ? {
          assertion: form.get("assertion"),
          owner: form.get("owner"),
          repo: form.get("repo"),
          brandSlug: form.get("brandSlug"),
        }
      : null,
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_launch_request" },
      { status: 400 },
    );
  }
  const { assertion, owner, repo, brandSlug } = parsed.data;
  const tenantId = `${owner}/${repo}`;
  let withinRateLimit;
  try {
    withinRateLimit = await checkExternalLaunchRateLimit(req, tenantId);
  } catch {
    return NextResponse.json(
      { error: "launch_security_unavailable" },
      { status: 503 },
    );
  }
  if (!withinRateLimit) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let brand;
  try {
    brand = await resolveClientBrand(brandSlug, { owner, repo });
  } catch {
    return NextResponse.json({ error: "brand_unavailable" }, { status: 503 });
  }
  if (!brand) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }
  if (brand.access.mode !== "delegated") {
    return NextResponse.json(
      { error: "delegated_access_not_enabled" },
      { status: 409 },
    );
  }

  let config;
  try {
    config = await resolveExternalIdentityConfig(owner, repo);
  } catch {
    return NextResponse.json(
      { error: "identity_configuration_unavailable" },
      { status: 503 },
    );
  }
  if (!config) {
    return NextResponse.json(
      { error: "identity_not_configured" },
      { status: 503 },
    );
  }

  let identity;
  try {
    identity = await verifyExternalLaunchAssertion(
      assertion,
      { owner, repo, brandSlug: brand.slug },
      config,
    );
  } catch {
    return NextResponse.json(
      { error: "invalid_launch_assertion" },
      { status: 401 },
    );
  }

  const token = await mintClientSession(
    {
      identity,
      owner,
      repo,
      brandSlug: brand.slug,
    },
    { ttlSec: EXTERNAL_CLIENT_SESSION_TTL_SEC },
  );
  const url = `/client/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(brand.slug)}`;
  const response = NextResponse.redirect(new URL(url, req.url), 303);
  setClientSessionCookie(response, token, {
    maxAge: EXTERNAL_CLIENT_SESSION_TTL_SEC,
  });
  return response;
}
