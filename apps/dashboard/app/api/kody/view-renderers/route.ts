/**
 * @fileType api-endpoint
 * @domain view-renderers
 * @pattern convex-crud-api
 * @ai-summary Lists and creates user-managed renderer definitions stored under
 *   `views/renderers/*.json` in the Kody backend.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@dashboard/lib/activity/audit";
import { resolveKodyRequestScope } from "@dashboard/lib/auth/kody-request-scope";
import { verifyActorLogin } from "@kody-ade/base/auth";
import {
  isValidViewRendererSlug,
  listViewRendererDefinitionsForTenant,
  parseViewRendererDefinition,
  readViewRendererDefinitionForTenant,
  writeViewRendererDefinitionForTenant,
} from "@dashboard/lib/view-renderers/renderers";
import {
  toViewRendererRow,
  viewRendererSourceForScope,
} from "@dashboard/lib/view-renderers/renderer-row";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const saveSchema = z.object({
  definition: z.string().min(2).max(20_000),
  actorLogin: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;

  try {
    const files = await listViewRendererDefinitionsForTenant(
      resolved.tenantId,
    );
    const rows = files
      .map((file) =>
        toViewRendererRow(file.definition, {
          htmlUrl: file.htmlUrl,
          source: viewRendererSourceForScope(
            Boolean(resolved.repository),
            file.source,
          ),
        }),
      )
      .sort((a, b) => a.slug.localeCompare(b.slug));
    return NextResponse.json(
      { renderers: rows },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[ViewRenderers] Error listing renderers:", error);
    return NextResponse.json(
      {
        error: "list_failed",
        message:
          error instanceof Error ? error.message : "Failed to list renderers",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(req: NextRequest) {
  const resolved = await resolveKodyRequestScope(req);
  if (resolved instanceof NextResponse) return resolved;

  try {
    const payload = saveSchema.parse(await req.json());
    const definition = parseViewRendererDefinition(payload.definition);
    if (!isValidViewRendererSlug(definition.slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    if (resolved.repository) {
      const verified = await verifyActorLogin(req, payload.actorLogin);
      if (verified instanceof NextResponse) return verified;
    }
    const existing = await readViewRendererDefinitionForTenant({
      tenantId: resolved.tenantId,
      slug: definition.slug,
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "slug_taken",
          message: `Renderer "${definition.slug}" exists.`,
        },
        { status: 409 },
      );
    }
    const written = await writeViewRendererDefinitionForTenant({
      tenantId: resolved.tenantId,
      definition,
    });
    recordAudit(req, {
      action: "view-renderer.create",
      resource: definition.slug,
      detail: `created view renderer ${definition.slug}`,
    });
    return NextResponse.json({
      renderer: toViewRendererRow(written.definition, {
        htmlUrl: written.htmlUrl,
        source: viewRendererSourceForScope(
          Boolean(resolved.repository),
          written.source,
        ),
      }),
    });
  } catch (error) {
    console.error("[ViewRenderers] Error creating renderer:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "create_failed",
        message:
          error instanceof Error ? error.message : "Failed to create renderer",
      },
      { status: 500 },
    );
  }
}
