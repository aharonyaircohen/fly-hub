/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-backend-import-api
 * @ai-summary Imports a backend export dump into the Convex deployment via
 *   importExport.importChunk, chunked per table, with optional clear-first.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api as backendApi } from "@kody-ade/backend/api";

import { getRequestAuth, verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { withEscapedKeys } from "@kody-ade/backend/client";
import { REPO_SCOPED_TABLES } from "@kody-ade/backend/table-registry";

const CHUNK_SIZE = 50;
const MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries a Convex write when the deployment throttles (TooManyWrites). */
async function withWriteRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("TooManyWrites") || attempt >= MAX_RETRIES) {
        throw error;
      }
      await sleep(1000 * 2 ** attempt);
    }
  }
}

const importBodySchema = z.object({
  version: z.literal(1),
  tenantId: z.string().trim().min(1),
  exportedAt: z.string().optional(),
  clearFirst: z.boolean().optional(),
  tables: z.record(
    z.string().trim().min(1),
    z.array(z.record(z.string(), z.unknown())),
  ),
});

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
}

export async function POST(req: NextRequest) {
  const authResult = await verifyRepoWriteAccess(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      {
        error: "convex_url_not_configured",
        message:
          "CONVEX_URL is not set. Configure the Convex deployment URL before importing.",
      },
      { status: 400 },
    );
  }

  const payload = await req.json().catch(() => null);
  const parsed = importBodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { tables, clearFirst } = parsed.data;
  const tenantId = `${headerAuth.owner}/${headerAuth.repo}`;
  const nonRepoTables = Object.keys(tables).filter(
    (table) => !REPO_SCOPED_TABLES.includes(table),
  );
  if (nonRepoTables.length > 0) {
    return NextResponse.json(
      { error: "non_repo_table", tables: nonRepoTables },
      { status: 400 },
    );
  }

  try {
    // Dumps carry original keys; the wrapper escapes reserved-prefix keys
    // ($text, _x) so any tenant payload survives the Convex wire.
    const client = withEscapedKeys(new ConvexHttpClient(convexUrl));

    if (clearFirst) {
      await withWriteRetry(() =>
        client.mutation(backendApi.importExport.clearRepo, { tenantId }),
      );
    }

    const counts: Array<[string, number]> = [];
    for (const [table, docs] of Object.entries(tables)) {
      const selectedRepoDocs = docs.map((doc) => ({ ...doc, tenantId }));
      for (const batch of chunk(selectedRepoDocs, CHUNK_SIZE)) {
        await withWriteRetry(() =>
          client.mutation(backendApi.importExport.importChunk, {
            table,
            docs: batch,
          }),
        );
        // Pace writes to stay under the free tier's per-second write budget.
        await sleep(250);
      }
      counts.push([table, docs.length]);
    }

    return NextResponse.json({
      ok: true,
      cleared: clearFirst === true,
      imported: Object.fromEntries(counts),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "failed_to_import_backend",
        message:
          error instanceof Error ? error.message : "failed_to_import_backend",
      },
      { status: 500 },
    );
  }
}
