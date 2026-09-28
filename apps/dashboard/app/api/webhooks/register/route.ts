/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern github-webhook-registration
 *
 * POST /api/webhooks/register
 *
 * Manual webhook registration entry point. Useful for re-running
 * registration on an already-connected repo, or for targeting a different
 * repo than the dashboard's current view.
 *
 * Body (optional): { owner?: string, repo?: string, events?: string[] }
 * Defaults to the headers' x-kody-owner / x-kody-repo, falling back to
 * the build-time GITHUB_OWNER / GITHUB_REPO constants.
 *
 * Authentication: the same per-request PAT every other dashboard route
 * uses — `x-kody-token` (with optional `x-kody-owner` / `x-kody-repo`).
 * Fine-grained PATs need repository Webhooks read/write permission. Classic
 * PATs need the `admin:repo_hook` scope.
 *
 * When GITHUB_WEBHOOK_SECRET or KODY_WEBHOOK_SECRET is configured, hooks are
 * registered with that secret and deliveries are HMAC-verified. Without a
 * secret, deliveries use the legacy GitHub source-IP check.
 */

import { NextRequest, NextResponse } from "next/server";
import { GITHUB_OWNER, GITHUB_REPO } from "@kody-ade/base/constants";
import { getPublicBaseUrl } from "@kody-ade/base/auth/oauth-url";
import { ensureWebhook } from "@dashboard/lib/webhooks/register";
import { readRecentWebhookDelivery } from "@dashboard/lib/webhooks/delivery-store";
import { provisionBackgroundGitHubAccess } from "@kody-ade/base/auth/background-token-provisioning";
import { logger } from "@kody-ade/base/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = req.headers.get("x-kody-token")?.trim();
  if (!token) {
    return NextResponse.json(
      { error: "missing_token", message: "x-kody-token header required" },
      { status: 401 },
    );
  }

  if (
    req.headers.get("x-kody-webhook-reconcile") === "automatic" &&
    process.env.VERCEL_ENV === "preview"
  ) {
    return NextResponse.json(
      { error: "preview_environment", skipped: true },
      { status: 422 },
    );
  }

  let body: { owner?: string; repo?: string; events?: string[] } = {};
  try {
    if (req.headers.get("content-length") !== "0") {
      body = (await req.json().catch(() => ({}))) as typeof body;
    }
  } catch {
    body = {};
  }

  const owner =
    body.owner?.trim() ||
    req.headers.get("x-kody-owner")?.trim() ||
    GITHUB_OWNER;
  const repo =
    body.repo?.trim() || req.headers.get("x-kody-repo")?.trim() || GITHUB_REPO;
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) {
    return NextResponse.json(
      { error: "invalid_owner_or_repo" },
      { status: 400 },
    );
  }

  let repoAccess: Response;
  try {
    repoAccess = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
  } catch {
    return NextResponse.json({ error: "github_unavailable" }, { status: 502 });
  }
  if (!repoAccess.ok) {
    const status =
      repoAccess.status === 401 ||
      repoAccess.status === 403 ||
      repoAccess.status === 404
        ? repoAccess.status
        : 502;
    return NextResponse.json(
      { error: "repository_access_failed", status: repoAccess.status },
      { status },
    );
  }

  let backgroundAccess: Awaited<
    ReturnType<typeof provisionBackgroundGitHubAccess>
  >;
  try {
    backgroundAccess = await provisionBackgroundGitHubAccess({
      owner,
      repo,
      token,
    });
  } catch {
    return NextResponse.json(
      { error: "background_access_failed" },
      { status: 502 },
    );
  }
  if (!backgroundAccess.ok) {
    return NextResponse.json(
      { error: "background_access_unavailable" },
      { status: 503 },
    );
  }

  if (backgroundAccess.source === "github-app") {
    return NextResponse.json({
      ok: true,
      webhookManaged: false,
      backgroundAccess,
    });
  }

  const hookUrl = `${getPublicBaseUrl(req)}/api/webhooks/github`;

  const result = await ensureWebhook({
    token,
    owner,
    repo,
    hookUrl,
    events: body.events,
  });

  if (!result.ok) {
    if (result.skipped) {
      return NextResponse.json(
        { error: result.error, skipped: true },
        { status: 422 },
      );
    }

    if (result.status === 403 || result.status === 404) {
      let recentDelivery = null;
      try {
        recentDelivery = await readRecentWebhookDelivery(owner, repo);
      } catch {
        // Delivery history is an optional proof path; keep the original
        // permission result when Convex is temporarily unavailable.
      }
      if (recentDelivery) {
        return NextResponse.json({
          ok: true,
          deliveryConfirmed: true,
          webhookManaged: false,
          backgroundAccess,
        });
      }
    }

    return NextResponse.json(
      { error: result.error, status: result.status, backgroundAccess },
      {
        status:
          result.status === 403 || result.status === 404 ? result.status : 502,
      },
    );
  }

  logger.info(
    {
      event: "webhook_registered",
      hookId: result.hookId,
      created: result.created,
      owner,
      repo,
    },
    "Webhook registered (manual endpoint)",
  );
  return NextResponse.json(
    {
      ok: true,
      hookId: result.hookId,
      created: result.created,
      url: hookUrl,
      webhookManaged: true,
      backgroundAccess,
    },
    { status: result.created ? 201 : 200 },
  );
}
