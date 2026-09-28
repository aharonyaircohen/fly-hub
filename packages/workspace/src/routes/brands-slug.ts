/**
 * @fileType api-endpoint
 * @domain client-chat
 * @pattern brands-api
 * @ai-summary Brand detail API. Reads, updates, and deletes repo-owned brand
 *   JSON files. Built-in fallback brands are readable through the list route
 *   but are not deleted or mutated directly.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import {
  isValidBrandSlug,
  isBrandDeleted,
  readBrandFile,
  removeBrand,
  writeBrandFile,
} from "../brands";
import { clientBrandAppearanceSchema } from "../brands/files";
import {
  getBuiltinClientBrand,
  normalizeClientBrandLocale,
  normalizeClientBrandSlug,
} from "@kody-ade/base/client-brand";
import { recordAudit } from "@kody-ade/base/activity/audit";

const updateBrandSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  accent: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  locale: z.string().trim().max(35).nullable().optional(),
  welcomeText: z.string().trim().max(1000).nullable().optional(),
  modelId: z.string().trim().min(1).max(160).nullable().optional(),
  agentSlug: z.string().trim().min(1).max(80).nullable().optional(),
  access: z
    .object({
      mode: z.enum(["public", "delegated"]),
    })
    .optional(),
  appearance: clientBrandAppearanceSchema.optional(),
  actorLogin: z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await verifyRepoReadAccess(req);
  if (authResult instanceof NextResponse) return authResult;

  const auth = getRequestAuth(req)!;
  const scope = { owner: auth.owner, repo: auth.repo };

  try {
    const { slug: rawSlug } = await params;
    const slug = normalizeClientBrandSlug(rawSlug);
    if (!isValidBrandSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    if (await isBrandDeleted(scope, slug)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const brand = await readBrandFile(scope, slug);
    if (brand) return NextResponse.json({ brand });

    const fallback = getBuiltinClientBrand(slug);
    if (fallback) {
      return NextResponse.json({
        brand: {
          ...fallback,
          source: "builtin",
          sha: "",
          updatedAt: "",
          htmlUrl: "",
        },
      });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error: any) {
    console.error("[Brands] Error fetching brand:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch brand",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await verifyRepoWriteAccess(req);
  if (authResult instanceof NextResponse) return authResult;

  const auth = getRequestAuth(req)!;
  const scope = { owner: auth.owner, repo: auth.repo };

  try {
    const { slug: rawSlug } = await params;
    const slug = normalizeClientBrandSlug(rawSlug);
    if (!isValidBrandSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    if (await isBrandDeleted(scope, slug)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const payload = await req.json();
    const parsed = updateBrandSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, parsed.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const existing = await readBrandFile(scope, slug);
    const base = existing ?? getBuiltinClientBrand(slug);
    if (!base) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const brand = await writeBrandFile(scope, {
      slug,
      name: parsed.name ?? base.name,
      accent: parsed.accent ?? base.accent,
      locale:
        parsed.locale === undefined
          ? base.locale
          : normalizeClientBrandLocale(parsed.locale ?? undefined),
      welcomeText:
        parsed.welcomeText === undefined
          ? base.welcomeText
          : (parsed.welcomeText ?? undefined),
      modelId:
        parsed.modelId === undefined
          ? base.modelId
          : (parsed.modelId ?? undefined),
      agentSlug:
        parsed.agentSlug === undefined
          ? base.agentSlug
          : (parsed.agentSlug ?? undefined),
      access: parsed.access ?? base.access,
      appearance: parsed.appearance ?? base.appearance,
    });

    recordAudit(req, {
      action: existing ? "brand.update" : "brand.overrideFallback",
      resource: slug,
      detail: `${existing ? "edited" : "overrode fallback"} brand ${slug}`,
    });

    return NextResponse.json({ brand });
  } catch (error: any) {
    console.error("[Brands] Error updating brand:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "update_failed",
        message: error?.message ?? "Failed to update brand",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await verifyRepoWriteAccess(req);
  if (authResult instanceof NextResponse) return authResult;

  const auth = getRequestAuth(req)!;
  const scope = { owner: auth.owner, repo: auth.repo };

  try {
    const { slug: rawSlug } = await params;
    const slug = normalizeClientBrandSlug(rawSlug);
    if (!isValidBrandSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const actorLogin =
      new URL(req.url).searchParams.get("actorLogin") ?? undefined;
    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const existing = await readBrandFile(scope, slug);
    const fallback = getBuiltinClientBrand(slug);
    if (!existing && !fallback) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await removeBrand(scope, slug, { disableFallback: Boolean(fallback) });
    recordAudit(req, {
      action: "brand.delete",
      resource: slug,
      detail: `deleted brand ${slug}`,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Brands] Error deleting brand:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete brand",
      },
      { status: 500 },
    );
  }
}
