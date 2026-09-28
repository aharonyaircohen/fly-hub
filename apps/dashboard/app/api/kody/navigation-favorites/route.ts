/**
 * @fileType api-route
 * @domain navigation
 * @pattern user-preferences-api
 * @ai-summary Reads and writes the authenticated user's global navigation
 * favorites in Convex, independent of the active repository.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  MAX_NAVIGATION_FAVORITES,
  normalizeFavoriteHrefs,
} from "@dashboard/lib/navigation-favorites";
import { ALL_NAV_ITEMS } from "@dashboard/lib/components/settings-nav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAVIGATION_NAMESPACE = "navigation";
const NAVIGATION_HREFS = new Set(ALL_NAV_ITEMS.map((item) => item.href));
const favoriteHrefsSchema = z
  .array(
    z
      .string()
      .startsWith("/")
      .refine((href) => NAVIGATION_HREFS.has(href), "Unknown navigation page"),
  )
  .max(MAX_NAVIGATION_FAVORITES)
  .refine(
    (hrefs) => new Set(hrefs).size === hrefs.length,
    "Duplicate navigation page",
  );
const updateSchema = z
  .object({ favoriteHrefs: favoriteHrefsSchema })
  .strict();

interface StoredNavigationPreferences {
  data?: { favoriteHrefs?: unknown };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;

  const record = (await createBackendClient().query(
    backendApi.userPreferences.get,
    {
      namespace: NAVIGATION_NAMESPACE,
      userKey: actor.id,
    },
  )) as StoredNavigationPreferences | null;
  return NextResponse.json({
    favoriteHrefs: normalizeFavoriteHrefs(
      record?.data?.favoriteHrefs,
      ALL_NAV_ITEMS,
    ),
  });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid favorites", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await createBackendClient().mutation(backendApi.userPreferences.save, {
    namespace: NAVIGATION_NAMESPACE,
    userKey: actor.id,
    data: { favoriteHrefs: parsed.data.favoriteHrefs },
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    favoriteHrefs: parsed.data.favoriteHrefs,
  });
}
