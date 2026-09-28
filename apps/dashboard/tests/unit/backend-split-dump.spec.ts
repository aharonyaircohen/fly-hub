import { describe, expect, it } from "vitest";

import {
  buildImportRequests,
  mergeImportedCounts,
  splitDumpTables,
  type BackendDump,
} from "@dashboard/lib/backend/split-dump";

function doc(id: number, padding = 0): Record<string, unknown> {
  return { id, pad: "x".repeat(padding) };
}

function makeDump(tables: Record<string, unknown[]>): BackendDump {
  return { version: 1, tenantId: "owner/repo", tables };
}

describe("splitDumpTables", () => {
  it("returns a single part unchanged when the dump fits the budget", () => {
    const tables = {
      workflows: [doc(1), doc(2)],
      reports: [doc(3)],
    };
    const parts = splitDumpTables(tables, 2_000_000);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual(tables);
  });

  it("returns one empty part for an empty dump", () => {
    expect(splitDumpTables({}, 2_000_000)).toEqual([{}]);
  });

  it("keeps empty tables so the server still sees them", () => {
    const parts = splitDumpTables({ empty: [], other: [doc(1)] }, 2_000_000);
    expect(parts).toHaveLength(1);
    expect(parts[0].empty).toEqual([]);
    expect(parts[0].other).toHaveLength(1);
  });

  it("splits across tables when the combined size exceeds the budget", () => {
    // Each doc is ~520 bytes; budget fits one table's docs but not both.
    const tables = {
      alpha: [doc(1, 500), doc(2, 500)],
      beta: [doc(3, 500), doc(4, 500)],
    };
    const parts = splitDumpTables(tables, 2_000);
    expect(parts.length).toBeGreaterThan(1);
    // No part exceeds the budget when serialized.
    for (const part of parts) {
      expect(JSON.stringify(part).length).toBeLessThanOrEqual(2_000);
    }
    // All docs survive, grouped under their original table.
    const merged = parts.reduce<Record<string, unknown[]>>(
      (acc, part) =>
        Object.entries(part).reduce(
          (inner, [table, docs]) => ({
            ...inner,
            [table]: [...(inner[table] ?? []), ...docs],
          }),
          acc,
        ),
      {},
    );
    expect(merged).toEqual(tables);
  });

  it("splits a single giant table's docs across parts by accumulated size", () => {
    const docs = Array.from({ length: 40 }, (_, i) => doc(i, 400));
    const parts = splitDumpTables({ reports: docs }, 2_000);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(Object.keys(part)).toEqual(["reports"]);
      expect(JSON.stringify(part).length).toBeLessThanOrEqual(2_000);
    }
    const merged = parts.flatMap((part) => part.reports);
    expect(merged).toEqual(docs);
  });

  it("splits by JSON size, not doc count — many tiny docs stay together", () => {
    const docs = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    const parts = splitDumpTables({ tiny: docs }, 2_000_000);
    expect(parts).toHaveLength(1);
    expect(parts[0].tiny).toHaveLength(500);
  });

  it("ships a doc larger than the budget alone in its own part", () => {
    const giant = doc(1, 5_000);
    const parts = splitDumpTables(
      { reports: [doc(0, 100), giant, doc(2, 100)] },
      2_000,
    );
    const giantPart = parts.find((part) =>
      part.reports.some((d) => (d as { id: number }).id === 1),
    );
    expect(giantPart?.reports).toEqual([giant]);
  });
});

describe("buildImportRequests", () => {
  it("sets clearFirst only on the first request", () => {
    const docs = Array.from({ length: 40 }, (_, i) => doc(i, 400));
    const requests = buildImportRequests(makeDump({ reports: docs }), true, 2_000);
    expect(requests.length).toBeGreaterThan(1);
    expect(requests[0].clearFirst).toBe(true);
    for (const req of requests.slice(1)) {
      expect(req.clearFirst).toBe(false);
    }
  });

  it("propagates clearFirst=false everywhere", () => {
    const requests = buildImportRequests(
      makeDump({ reports: [doc(1)] }),
      false,
      2_000,
    );
    expect(requests.every((req) => req.clearFirst === false)).toBe(true);
  });

  it("carries version and tenantId on every request", () => {
    const docs = Array.from({ length: 10 }, (_, i) => doc(i, 400));
    const requests = buildImportRequests(makeDump({ reports: docs }), true, 2_000);
    for (const req of requests) {
      expect(req.version).toBe(1);
      expect(req.tenantId).toBe("owner/repo");
    }
  });
});

describe("mergeImportedCounts", () => {
  it("sums per-table counts across parts", () => {
    expect(
      mergeImportedCounts([
        { reports: 50, workflows: 3 },
        { reports: 25 },
        { agents: 2 },
      ]),
    ).toEqual({ reports: 75, workflows: 3, agents: 2 });
  });

  it("returns an empty record for no parts", () => {
    expect(mergeImportedCounts([])).toEqual({});
  });
});
