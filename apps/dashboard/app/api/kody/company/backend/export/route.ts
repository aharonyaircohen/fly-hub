/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-backend-export-api
 * @ai-summary Exports the tenant's backend data straight from Convex (the
 *   system of record) as a DB-agnostic JSON dump keyed by backend table.
 *   This is the standing backup tool; the one-time GitHub backend export
 *   lives at ../export-github for first-time migrations.
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api as backendApi } from "@kody-ade/backend/api";

import { verifyRepoReadAccess } from "@kody-ade/base/auth";
import { withEscapedKeys } from "@kody-ade/backend/client";
import { REPO_SCOPED_TABLES } from "@kody-ade/backend/table-registry";

export interface BackendExportDump {
  version: 1;
  exportedAt: string;
  tenantId: string;
  skipped: number;
  failures: string[];
  tables: Record<string, Array<Record<string, unknown>>>;
}

export async function GET(req: NextRequest) {
  const access = await verifyRepoReadAccess(req);
  if (access instanceof NextResponse) return access;

  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      {
        error: "convex_url_not_configured",
        message:
          "CONVEX_URL is not set. Configure the Convex deployment URL before exporting.",
      },
      { status: 400 },
    );
  }

  const { owner, repo } = access.auth;
  const tenantId = `${owner}/${repo}`;
  const now = new Date().toISOString();

  try {
    // Dumps must carry original (unescaped) keys; the wrapper unescapes
    // reserved-prefix keys ($text, _x) on the way out of the Convex wire.
    const client = withEscapedKeys(new ConvexHttpClient(convexUrl));

    const tables: Array<[string, Array<Record<string, unknown>>]> = [];
    const failures: string[] = [];
    for (const table of REPO_SCOPED_TABLES) {
      try {
        const docs = (await client.query(backendApi.importExport.exportTable, {
          table,
          tenantId,
        })) as Array<Record<string, unknown>>;
        if (docs.length > 0) tables.push([table, docs]);
      } catch {
        failures.push(table);
      }
    }

    const dump: BackendExportDump = {
      version: 1,
      exportedAt: now,
      tenantId,
      skipped: 0,
      failures,
      tables: Object.fromEntries(tables),
    };

    const filename = `backend-export-${owner}-${repo}-${now.slice(0, 10)}.json`;
    return NextResponse.json(dump, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "failed_to_export_backend",
        message:
          error instanceof Error ? error.message : "failed_to_export_backend",
      },
      { status: 500 },
    );
  }
}
