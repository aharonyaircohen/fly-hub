/**
 * @fileType api-endpoint
 * @domain widgets
 * @pattern widget-bundle-serving
 * @ai-summary Serves the tenant's latest published widget bundle as
 *   JavaScript so the chat surface can dynamic-import() it. Auth context
 *   comes from the standard x-kody-* headers OR from query params
 *   (?owner=&repo=&token=) because browser dynamic import() cannot set
 *   headers. Responses carry a version-keyed ETag so repeat loads are a
 *   cheap 304 revalidation.
 */
import { NextRequest, NextResponse } from "next/server";

import { getRequestAuth, requireKodyAuth } from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { getChatRequestContextProvider } from "../../chat/request-context-provider";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const WIDGET_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

interface WidgetRow {
  tenantId: string;
  slug: string;
  version: number;
  bundle: string;
  commitSha?: string;
  updatedAt: string;
}

interface WidgetRequestAuth {
  owner: string;
  repo: string;
}

function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...(init?.headers ?? {}) },
  });
}

/**
 * Resolve auth the same way the other kody routes do (x-kody-* headers via
 * getRequestAuth), with a query-param fallback (?owner=&repo=&token=) for
 * browser dynamic import() which cannot attach custom headers.
 */
function resolveWidgetRequestAuth(req: NextRequest): WidgetRequestAuth | null {
  const headerAuth = getRequestAuth(req);
  if (headerAuth) return { owner: headerAuth.owner, repo: headerAuth.repo };
  const params = new URL(req.url).searchParams;
  const owner = params.get("owner")?.trim();
  const repo = params.get("repo")?.trim();
  const token = params.get("token")?.trim();
  if (!owner || !repo || !token) return null;
  return { owner, repo };
}

function tenantIdFor(auth: WidgetRequestAuth): string {
  return `${auth.owner}/${auth.repo}`;
}

function widgetEtag(row: WidgetRow): string {
  return `"widget-${row.slug}-v${row.version}"`;
}

const BUNDLE_CACHE_HEADERS = {
  // Private (token-gated) and always revalidated: the version-keyed ETag
  // turns unchanged repeat loads into 304s without ever serving a stale
  // bundle after a new publish.
  "Cache-Control": "private, max-age=0, must-revalidate",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: rawSlug } = await params;
  const slug = rawSlug?.trim() ?? "";
  if (!WIDGET_SLUG_RE.test(slug)) {
    return json({ error: "invalid_widget_slug" }, { status: 400 });
  }

  const hostUser = await getChatRequestContextProvider()?.resolveUser(req);
  const auth = resolveWidgetRequestAuth(req);
  if (!hostUser && !auth) {
    return json(
      {
        error: "not_authenticated",
        message:
          "Provide x-kody-token, x-kody-owner, and x-kody-repo headers, or owner/repo/token query params.",
      },
      { status: 401 },
    );
  }

  try {
    const requestedVersion = Number(
      new URL(req.url).searchParams.get("version") ?? "",
    );
    if (
      new URL(req.url).searchParams.has("version") &&
      (!Number.isInteger(requestedVersion) || requestedVersion < 1)
    ) {
      return json({ error: "invalid_widget_version" }, { status: 400 });
    }
    const client = createBackendClient();
    const row =
      Number.isInteger(requestedVersion) && requestedVersion > 0
        ? ((await client.query(backendApi.widgets.getVersion, {
            tenantId: auth ? tenantIdFor(auth) : `user:${hostUser!.id}`,
            slug,
            version: requestedVersion,
          })) as WidgetRow | null)
        : ((await client.query(backendApi.widgets.latest, {
            tenantId: auth ? tenantIdFor(auth) : `user:${hostUser!.id}`,
            slug,
          })) as WidgetRow | null);
    if (!row) {
      return json({ error: "widget_not_found" }, { status: 404 });
    }

    const etag = widgetEtag(row);
    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, ...BUNDLE_CACHE_HEADERS },
      });
    }
    return new NextResponse(row.bundle, {
      status: 200,
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        ETag: etag,
        ...BUNDLE_CACHE_HEADERS,
      },
    });
  } catch (error) {
    console.error("[Widgets] bundle load failed", error);
    return json({ error: "widget_unavailable" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: rawSlug } = await params;
  const slug = rawSlug?.trim() ?? "";
  if (!WIDGET_SLUG_RE.test(slug)) {
    return json({ error: "invalid_widget_slug" }, { status: 400 });
  }

  const hostUser = await getChatRequestContextProvider()?.resolveUser(req);
  const auth = getRequestAuth(req);
  if (auth) {
    const authError = await requireKodyAuth(req);
    if (authError) return authError;
  }
  if (!hostUser && !auth) {
    return json({ error: "not_authenticated" }, { status: 401 });
  }

  try {
    const tenantId = auth ? tenantIdFor(auth) : `user:${hostUser!.id}`;
    const deletedVersions = (await createBackendClient().mutation(
      backendApi.widgets.remove,
      { tenantId, slug },
    )) as number;
    if (deletedVersions === 0) {
      return json({ error: "widget_not_found" }, { status: 404 });
    }
    return json({ slug, deletedVersions });
  } catch (error) {
    console.error("[Widgets] delete failed", error);
    return json({ error: "widget_delete_failed" }, { status: 500 });
  }
}
