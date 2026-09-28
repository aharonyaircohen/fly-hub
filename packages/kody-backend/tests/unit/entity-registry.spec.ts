import { describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import { TABLES, IMPORTABLE_TABLES } from "../../src/table-registry";

// Drift guard: every schema table must be registered in src/entities.ts and
// vice versa. If this fails you added a table or an entity in only one place —
// register it in the entity registry, never in downstream lists.
describe("entity registry drift", () => {
  const schemaTables = Object.keys(schema.tables).sort();
  const registryTables = TABLES.map((entry) => entry.table).sort();

  it("covers every schema table", () => {
    expect(registryTables).toEqual(schemaTables);
  });

  it("has no duplicate table entries", () => {
    const tables = TABLES.map((e) => e.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("keeps transient runtime tables out of backup and restore", () => {
    const transientTables = TABLES.filter((entry) => entry.transient).map(
      (entry) => entry.table,
    );

    expect(transientTables).toContain("workflowRunLeases");
    expect(IMPORTABLE_TABLES).not.toContain("workflowRunLeases");
  });

  it("every entity declares a natural key or an explicit tenant-singleton contract", () => {
    for (const entity of TABLES) {
      const tenantSingleton =
        "tenantSingleton" in entity && entity.tenantSingleton === true;
      if (tenantSingleton) {
        expect(
          entity.global,
          `${entity.table} singleton cannot be global`,
        ).not.toBe(true);
        expect(
          entity.naturalKey,
          `${entity.table} singleton must use tenantId as its complete identity`,
        ).toEqual([]);
      } else {
        expect(
          entity.naturalKey.length,
          `${entity.table} has no naturalKey`,
        ).toBeGreaterThan(0);
      }
      const table = (schema.tables as Record<string, unknown>)[
        entity.table
      ] as {
        export: () => { documentType: { value: Record<string, unknown> } };
      };
      const schemaFields = Object.keys(table.export().documentType.value);
      for (const field of entity.naturalKey) {
        const rootField = field.split(".", 1)[0];
        expect(
          schemaFields,
          `${entity.table}.naturalKey field "${field}" missing from schema`,
        ).toContain(rootField);
      }
      expect(
        entity.naturalKey,
        `${entity.table} naturalKey must not include tenantId`,
      ).not.toContain("tenantId");
    }
  });

  it("every declared upsertIndex exists and is prefixed by [tenantId?, ...naturalKey]", () => {
    for (const entity of TABLES) {
      if (!entity.upsertIndex) continue;
      const table = (schema.tables as Record<string, unknown>)[
        entity.table
      ] as {
        export: () => {
          indexes: Array<{ indexDescriptor: string; fields: string[] }>;
        };
      };
      const index = table
        .export()
        .indexes.find((i) => i.indexDescriptor === entity.upsertIndex);
      expect(
        index,
        `${entity.table} upsertIndex "${entity.upsertIndex}" not in schema`,
      ).toBeDefined();
      const expectedPrefix = entity.global
        ? entity.naturalKey
        : ["tenantId", ...entity.naturalKey];
      expect(
        index?.fields.slice(0, expectedPrefix.length),
        `${entity.table} index "${entity.upsertIndex}" does not cover the natural key`,
      ).toEqual(expectedPrefix);
    }
  });
});
