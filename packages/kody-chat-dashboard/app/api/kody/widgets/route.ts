/**
 * @fileType api-endpoint
 * @domain widgets
 * @pattern backend-crud-api
 * @ai-summary Admin surface for the tenant's widget store. GET lists the
 *   latest published version per slug (metadata only — bundles stay in the
 *   backend). POST publishes a new bundle version for a slug. Auth is the
 *   standard x-kody-* header check (requireKodyAuth + getRequestAuth);
 *   tenant identity is owner/repo, same as the bundle-serving route.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestAuth, requireKodyAuth } from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  normalizeWidgetName,
  widgetNameFromSlug,
  widgetSlugFromName,
} from "../../../../src/dashboard/lib/widgets/identity";
import { getChatRequestContextProvider } from "../chat/request-context-provider";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const WIDGET_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Convex documents cap at ~1MB — leave headroom for the metadata fields. */
const MAX_BUNDLE_CHARS = 900_000;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const publishSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: z
      .string()
      .trim()
      .regex(WIDGET_SLUG_RE, "Slug must be lowercase letters, digits, - or _.")
      .optional(),
    bundle: z
      .string()
      .min(1, "Bundle is empty.")
      .max(
        MAX_BUNDLE_CHARS,
        `Bundle exceeds ${MAX_BUNDLE_CHARS} characters (backend document limit).`,
      ),
    commitSha: z.string().trim().max(64).optional(),
  })
  .refine((input) => input.name || input.slug, {
    message: "Widget name is required.",
  });

interface WidgetListRow {
  tenantId: string;
  name?: string;
  slug: string;
  version: number;
  bundleSize: number;
  commitSha?: string;
  updatedAt: string;
}

function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...(init?.headers ?? {}) },
  });
}

export async function GET(req: NextRequest) {
  const hostUser = await getChatRequestContextProvider()?.resolveUser(req);
  const auth = getRequestAuth(req);
  if (auth) {
    const authError = await requireKodyAuth(req);
    if (authError) return authError;
  }
  if (!hostUser && !auth) {
    return json({ error: "missing_repo_context" }, { status: 401 });
  }
  const tenantId = auth ? `${auth.owner}/${auth.repo}` : `user:${hostUser!.id}`;

  try {
    const widgets = (await createBackendClient().query(
      backendApi.widgets.list,
      {
        tenantId,
      },
    )) as WidgetListRow[];
    return json({
      widgets: widgets.map((widget) => ({
        ...widget,
        name: widget.name || widgetNameFromSlug(widget.slug),
      })),
    });
  } catch (error) {
    console.error("[Widgets] list failed", error);
    return json({ error: "widgets_unavailable" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const hostUser = await getChatRequestContextProvider()?.resolveUser(req);
  const auth = getRequestAuth(req);
  if (auth) {
    const authError = await requireKodyAuth(req);
    if (authError) return authError;
  }
  if (!hostUser && !auth) {
    return json({ error: "missing_repo_context" }, { status: 401 });
  }
  const tenantId = auth ? `${auth.owner}/${auth.repo}` : `user:${hostUser!.id}`;

  let input: z.infer<typeof publishSchema>;
  try {
    input = publishSchema.parse(await req.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join(" ")
        : "Body must be JSON with slug and bundle.";
    return json({ error: "invalid_widget", message }, { status: 400 });
  }

  try {
    const name = normalizeWidgetName(
      input.name ?? widgetNameFromSlug(input.slug ?? ""),
    );
    const slug = input.name ? widgetSlugFromName(name) : (input.slug ?? "");
    if (!name || !WIDGET_SLUG_RE.test(slug)) {
      return json(
        {
          error: "invalid_widget",
          message: "Widget name must produce a valid slug.",
        },
        { status: 400 },
      );
    }
    const version = (await createBackendClient().mutation(
      backendApi.widgets.publish,
      {
        tenantId,
        slug,
        bundle: input.bundle,
        ...(input.commitSha ? { commitSha: input.commitSha } : {}),
        updatedAt: new Date().toISOString(),
      },
    )) as number;
    return json({ name, slug, version });
  } catch (error) {
    console.error("[Widgets] publish failed", error);
    return json({ error: "widget_publish_failed" }, { status: 500 });
  }
}
