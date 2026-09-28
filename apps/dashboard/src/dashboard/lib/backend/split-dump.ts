/**
 * @fileType utility
 * @domain kody
 * @pattern backend-dump-splitter
 * @ai-summary Splits a backend export dump into multiple import request
 *   bodies, each under a JSON-size budget, so large dumps upload without
 *   hitting the serverless body limit (HTTP 413). Splits per table and,
 *   when a single table is too big, splits its docs array by accumulated
 *   JSON size. clearFirst is only set on the first request.
 */

/** Keep each request body comfortably under the ~4.5MB serverless limit. */
export const DEFAULT_MAX_PART_BYTES = 2_000_000;

/** Rough envelope overhead per request (version, tenantId, clearFirst, braces). */
const ENVELOPE_OVERHEAD_BYTES = 256;
/** Rough per-table overhead within a part (quoted key, colon, brackets, comma). */
const TABLE_OVERHEAD_BYTES = 16;

export interface BackendDump {
  version: 1;
  tenantId: string;
  tables: Record<string, unknown[]>;
}

export interface ImportRequestBody {
  version: 1;
  tenantId: string;
  clearFirst: boolean;
  tables: Record<string, unknown[]>;
}

function tableKeyBytes(table: string): number {
  return table.length + TABLE_OVERHEAD_BYTES;
}

function docBytes(doc: unknown): number {
  return JSON.stringify(doc).length + 1;
}

/**
 * Splits a dump's tables into parts whose serialized size stays under
 * `maxPartBytes`. Whole tables are packed together when they fit; a table
 * whose docs exceed the budget on their own is split across parts by
 * accumulated JSON size (never by doc count). A single doc larger than the
 * budget still ships alone in its own part — nothing smaller is possible.
 */
export function splitDumpTables(
  tables: Record<string, unknown[]>,
  maxPartBytes: number = DEFAULT_MAX_PART_BYTES,
): Array<Record<string, unknown[]>> {
  const budget = Math.max(1, maxPartBytes - ENVELOPE_OVERHEAD_BYTES);
  const parts: Array<Record<string, unknown[]>> = [];
  let current: Record<string, unknown[]> = {};
  let currentBytes = 0;

  const flush = () => {
    if (Object.keys(current).length > 0) {
      parts.push(current);
      current = {};
      currentBytes = 0;
    }
  };

  for (const [table, docs] of Object.entries(tables)) {
    let opened = false;
    const openTable = () => {
      if (!opened || !(table in current)) {
        current = { ...current, [table]: current[table] ?? [] };
        currentBytes += tableKeyBytes(table);
        opened = true;
      }
    };

    if (docs.length === 0) {
      if (currentBytes + tableKeyBytes(table) > budget) flush();
      openTable();
      continue;
    }

    for (const doc of docs) {
      const cost = docBytes(doc);
      const keyCost = table in current ? 0 : tableKeyBytes(table);
      if (currentBytes > 0 && currentBytes + keyCost + cost > budget) {
        flush();
        opened = false;
      }
      openTable();
      current = { ...current, [table]: [...current[table], doc] };
      currentBytes += cost;
    }
  }

  flush();
  return parts.length > 0 ? parts : [{}];
}

/**
 * Builds the sequence of import request bodies for a dump. `clearFirst`
 * is only true on the first request so later parts never wipe the docs
 * imported by earlier ones.
 */
export function buildImportRequests(
  dump: BackendDump,
  clearFirst: boolean,
  maxPartBytes: number = DEFAULT_MAX_PART_BYTES,
): ImportRequestBody[] {
  return splitDumpTables(dump.tables, maxPartBytes).map((tables, index) => ({
    version: 1,
    tenantId: dump.tenantId,
    clearFirst: clearFirst && index === 0,
    tables,
  }));
}

/** Merges per-table doc counts from multiple import responses. */
export function mergeImportedCounts(
  parts: Array<Record<string, number>>,
): Record<string, number> {
  return parts.reduce<Record<string, number>>(
    (acc, imported) =>
      Object.entries(imported).reduce(
        (inner, [table, count]) => ({
          ...inner,
          [table]: (inner[table] ?? 0) + count,
        }),
        acc,
      ),
    {},
  );
}
