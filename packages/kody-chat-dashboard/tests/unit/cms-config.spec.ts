import { describe, expect, it, vi, beforeEach } from "vitest";

const backendDocs = vi.hoisted(() => ({
  readCmsFile: vi.fn(),
}));

vi.mock("@kody-ade/cms/repo-docs", () => ({
  readCmsFile: backendDocs.readCmsFile,
}));

import {
  getCollection,
  invalidateCmsConfigCache,
  loadCmsConfigFromState,
  normalizeCmsConfig,
  normalizeSearchQuery,
  normalizeSortQuery,
} from "@kody-ade/cms/config";
import { readCmsFile } from "@kody-ade/cms/repo-docs";

describe("CMS config contract", () => {
  const mockReadStateText = vi.mocked(readCmsFile);

  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCmsConfigCache();
  });

  it("treats a missing root cms/config.json as unconfigured", async () => {
    mockReadStateText.mockResolvedValueOnce(null);

    await expect(
      loadCmsConfigFromState({} as never, "A-Guy-educ", "A-Guy-Web"),
    ).resolves.toBeNull();

    expect(readCmsFile).toHaveBeenCalledWith(
      "A-Guy-educ",
      "A-Guy-Web",
      "cms/config.json",
    );
  });

  it("loads empty root cms/config.json as configured", async () => {
    mockReadStateText.mockResolvedValueOnce({
      updatedAt: "2026-01-01T00:00:00.000Z",
      sha: "config-sha",
      content: JSON.stringify({
        version: 1,
        name: "Empty CMS",
        environment: "default",
        writePolicy: "read-only",
        collections: [],
      }),
    });

    await expect(
      loadCmsConfigFromState({} as never, "A-Guy-educ", "A-Guy-Web"),
    ).resolves.toMatchObject({
      name: "Empty CMS",
      collections: {},
    });
  });

  it("still fails when a referenced CMS file is missing", async () => {
    mockReadStateText
      .mockResolvedValueOnce({
        updatedAt: "2026-01-01T00:00:00.000Z",
        sha: "config-sha",
        content: JSON.stringify({
          version: 1,
          collections: ["collections/records.json"],
        }),
      })
      .mockResolvedValueOnce(null);

    await expect(
      loadCmsConfigFromState({} as never, "A-Guy-educ", "A-Guy-Admin"),
    ).rejects.toMatchObject({
      name: "CmsConfigError",
      code: "cms_config_error",
      message: "missing state file: cms/collections/records.json",
    });
  });

  it("dedupes concurrent config loads", async () => {
    mockReadStateText.mockResolvedValue({
      updatedAt: "2026-01-01T00:00:00.000Z",
      sha: "config-sha",
      content: JSON.stringify({
        version: 1,
        defaultAdapter: "memory",
        collections: {
          records: {
            name: "records",
            fields: [{ name: "title", type: "text" }],
          },
        },
      }),
    });

    const [first, second] = await Promise.all([
      loadCmsConfigFromState({} as never, "A-Guy-educ", "A-Guy-Web"),
      loadCmsConfigFromState({} as never, "A-Guy-educ", "A-Guy-Web"),
    ]);

    expect(first).toEqual(second);
    expect(readCmsFile).toHaveBeenCalledTimes(1);
  });

  it("loads referenced collection files concurrently", async () => {
    let activeCollectionReads = 0;
    let maxActiveCollectionReads = 0;

    mockReadStateText.mockImplementation(async (_owner, _repo, path) => {
      if (path === "cms/config.json") {
        return {
          updatedAt: "2026-01-01T00:00:00.000Z",
          sha: "config-sha",
          content: JSON.stringify({
            version: 1,
            defaultAdapter: "memory",
            collections: [
              "collections/alpha.json",
              "collections/beta.json",
              "collections/gamma.json",
            ],
          }),
        };
      }

      activeCollectionReads += 1;
      maxActiveCollectionReads = Math.max(
        maxActiveCollectionReads,
        activeCollectionReads,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeCollectionReads -= 1;

      const name = String(path).match(/collections\/(.+)\.json$/)?.[1];
      return {
        updatedAt: "2026-01-01T00:00:00.000Z",
        sha: `${name}-sha`,
        content: JSON.stringify({
          name,
          fields: [{ name: "title", type: "text" }],
        }),
      };
    });

    const config = await loadCmsConfigFromState(
      {} as never,
      "A-Guy-educ",
      "A-Guy-Admin",
    );

    expect(Object.keys(config?.collections ?? {})).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(maxActiveCollectionReads).toBeGreaterThan(1);
  });

  it("normalizes environment-materialized collection maps", () => {
    const config = normalizeCmsConfig({
      version: 1,
      name: "Example CMS",
      environment: "dev",
      defaultAdapter: "content-store",
      writePolicy: "read-only",
      adapters: {
        "content-store": {
          endpointSecret: "DATABASE_URL",
          workspace: "development",
        },
      },
      collections: {
        records: {
          name: "records",
          label: "Records",
          source: { collection: "records", idField: "_id" },
          titleField: "title",
          listFields: ["title", "child", "updatedAt"],
          views: {
            list: {
              pageSize: 50,
              fields: [
                { name: "title", role: "primary", width: "fill" },
                { name: "child", display: "label", width: "sm" },
                { name: "updatedAt", sortable: false },
              ],
            },
            detail: { fields: ["_id", "title", "child", "updatedAt"] },
            form: { fields: ["title", "child"] },
          },
          fields: [
            { name: "_id", type: "id", label: "ID", readOnly: true },
            { name: "title", type: "text", label: "Title" },
            {
              name: "child",
              type: "relation",
              label: "Child",
              target: "children",
            },
            { name: "updatedAt", type: "date", label: "Updated At" },
          ],
          filters: [
            { field: "title", operators: ["contains", "equals"] },
            { field: "child", operators: ["equals"] },
          ],
        },
      },
    });

    expect(config.collections.records.adapter).toBe("content-store");
    expect(config.collections.records.writePolicy).toBe("read-only");
    expect(config.collections.records.searchFields).toEqual(["title"]);
    expect(config.collections.records.listFields).toEqual([
      "title",
      "child",
      "updatedAt",
    ]);
    expect(config.collections.records.views?.list?.pageSize).toBe(50);
    expect(config.collections.records.views?.list?.fields).toEqual([
      { name: "title", role: "primary", width: "fill" },
      { name: "child", display: "label", width: "sm" },
      { name: "updatedAt", sortable: false },
    ]);
    expect(config.collections.records.views?.detail?.fields).toEqual([
      { name: "_id" },
      { name: "title" },
      { name: "child" },
      { name: "updatedAt" },
    ]);
    expect(config.collections.records.views?.form?.fields).toEqual([
      { name: "title" },
      { name: "child" },
    ]);
    expect(config.collections.records.operations).toMatchObject({
      list: true,
      get: true,
      search: true,
      create: false,
      update: false,
      delete: false,
    });
    expect(config.adapters["content-store"].workspace).toBe("development");
  });

  it("allows empty collection configs", () => {
    const config = normalizeCmsConfig({
      version: 1,
      name: "Empty CMS",
      environment: "default",
      defaultAdapter: "content-store",
      writePolicy: "read-only",
      collections: [],
    });

    expect(config.collections).toEqual({});
    expect(config.name).toBe("Empty CMS");
  });

  it("preserves opaque adapter settings", () => {
    const config = normalizeCmsConfig({
      version: 1,
      name: "Example CMS",
      environment: "dev",
      defaultAdapter: "example",
      writePolicy: "read-only",
      adapters: {
        example: {
          secretName: "DATABASE_URL",
          region: "local",
          preview: true,
        },
      },
      collections: {
        records: {
          name: "records",
          fields: [{ name: "_id", type: "id" }],
        },
      },
    });

    expect(config.adapters.example).toEqual({
      secretName: "DATABASE_URL",
      region: "local",
      preview: true,
    });
  });

  it("normalizes non-slug collection names while preserving the source collection", () => {
    const config = normalizeCmsConfig({
      version: 1,
      defaultAdapter: "mongodb",
      writePolicy: "enabled",
      collections: {
        A: {
          name: "A",
          label: "A",
          source: { collection: "A", idField: "_id" },
          fields: [{ name: "_id", type: "id" }],
        },
      },
    });

    expect(Object.keys(config.collections)).toEqual(["a"]);
    expect(config.collections.a).toMatchObject({
      name: "a",
      label: "A",
      source: { collection: "A", idField: "_id" },
    });
    expect(getCollection(config, "A")).toBe(config.collections.a);
    expect(getCollection(config, "a")).toBe(config.collections.a);
  });

  it("requires collection adapter when no default adapter is set", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          records: {
            name: "records",
            fields: [{ name: "title", type: "text" }],
          },
        },
      }),
    ).toThrow(/records\.adapter required when defaultAdapter is not set/);
  });

  it("rejects unknown field types", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          records: {
            name: "records",
            fields: [{ name: "title", type: "madeUp" }],
          },
        },
      }),
    ).toThrow(/type is invalid/);
  });

  it("rejects list fields that are not configured fields", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          records: {
            name: "records",
            listFields: ["title", "missing"],
            fields: [{ name: "title", type: "text" }],
          },
        },
      }),
    ).toThrow(/listFields references unknown field: missing/);
  });

  it("rejects view fields that are not configured fields", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          records: {
            name: "records",
            views: { list: { fields: ["missing"] } },
            fields: [{ name: "title", type: "text" }],
          },
        },
      }),
    ).toThrow(/views\.list\.fields references unknown field: missing/);
  });

  it("rejects default sort fields that are not configured fields", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          records: {
            name: "records",
            fields: [{ name: "title", type: "text" }],
            defaultSort: [{ field: "missing", direction: "asc" }],
          },
        },
      }),
    ).toThrow(/defaultSort references unknown field: missing/);
  });

  it("rejects search fields that are not configured fields", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        collections: {
          records: {
            name: "records",
            fields: [{ name: "title", type: "text" }],
            searchFields: ["missing"],
          },
        },
      }),
    ).toThrow(/searchFields references unknown field: missing/);
  });

  it("validates runtime sort query fields against collection fields", () => {
    const config = normalizeCmsConfig({
      version: 1,
      defaultAdapter: "memory",
      collections: {
        records: {
          name: "records",
          fields: [
            { name: "_id", type: "id" },
            { name: "title", type: "text" },
          ],
        },
      },
    });

    expect(
      normalizeSortQuery(config.collections.records, [
        { field: "title", direction: "asc" },
      ]),
    ).toEqual([{ field: "title", direction: "asc" }]);
    expect(() =>
      normalizeSortQuery(config.collections.records, [
        { field: "$where", direction: "desc" },
      ]),
    ).toThrow(/unknown sort field: \$where/);
  });

  it("validates runtime search query fields against collection fields", () => {
    const config = normalizeCmsConfig({
      version: 1,
      defaultAdapter: "memory",
      collections: {
        parents: {
          name: "parents",
          titleField: "title",
          fields: [
            { name: "_id", type: "id" },
            { name: "title", type: "text" },
          ],
        },
      },
    });

    expect(
      normalizeSearchQuery(config.collections.parents, {
        query: "math",
      }),
    ).toEqual({ query: "math", fields: ["title"] });
    expect(() =>
      normalizeSearchQuery(config.collections.parents, {
        query: "math",
        fields: ["missing"],
      }),
    ).toThrow(/unknown search field: missing/);
  });

  it("preserves field storage metadata", () => {
    const config = normalizeCmsConfig({
      version: 1,
      defaultAdapter: "memory",
      collections: {
        records: {
          name: "records",
          fields: [
            { name: "_id", type: "id", storage: { kind: "objectId" } },
            {
              name: "child",
              type: "relation",
              target: "children",
              storage: { kind: "objectId" },
            },
            {
              name: "tags",
              type: "multiSelect",
              storage: { kind: "stringArray" },
            },
          ],
        },
      },
    });

    expect(config.collections.records.fields).toMatchObject([
      { name: "_id", storage: { kind: "objectId" } },
      { name: "child", storage: { kind: "objectId" } },
      { name: "tags", storage: { kind: "stringArray" } },
    ]);
  });

  it("normalizes field display hints, validation rules, and table view aliases", () => {
    const config = normalizeCmsConfig({
      version: 1,
      defaultAdapter: "memory",
      collections: {
        records: {
          name: "records",
          views: {
            table: {
              pageSize: 25,
              fields: ["title", { name: "status", sortable: false }],
            },
            detail: { fields: ["title", "status"] },
            form: { fields: ["title", "status"] },
          },
          fields: [
            {
              name: "title",
              type: "text",
              label: "Title",
              description: "Public record title",
              placeholder: "Example record",
              display: {
                role: "primary",
                width: "fill",
                format: "text",
              },
              validation: {
                minLength: 3,
                maxLength: 80,
                pattern: "^[A-Z].+",
              },
            },
            {
              name: "status",
              type: "select",
              options: ["draft", "published"],
              display: {
                role: "meta",
                width: "sm",
              },
            },
          ],
        },
      },
    });

    expect(config.collections.records.fields[0]).toMatchObject({
      name: "title",
      description: "Public record title",
      placeholder: "Example record",
      display: {
        role: "primary",
        width: "fill",
        format: "text",
      },
      validation: {
        minLength: 3,
        maxLength: 80,
        pattern: "^[A-Z].+",
      },
    });
    expect(config.collections.records.views?.table).toEqual(
      config.collections.records.views?.list,
    );
    expect(config.collections.records.views?.table?.fields).toEqual([
      { name: "title", role: "primary", format: "text", width: "fill" },
      { name: "status", role: "meta", width: "sm", sortable: false },
    ]);
  });

  it("rejects invalid field display and validation metadata", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        defaultAdapter: "memory",
        collections: {
          records: {
            name: "records",
            fields: [
              {
                name: "title",
                type: "text",
                display: { width: "huge" },
                validation: { pattern: "[" },
              },
            ],
          },
        },
      }),
    ).toThrow(/display\.width is invalid.*validation\.pattern is invalid/s);
  });

  it("rejects invalid field storage metadata", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        defaultAdapter: "memory",
        collections: {
          records: {
            name: "records",
            fields: [{ name: "_id", type: "id", storage: { kind: "madeUp" } }],
          },
        },
      }),
    ).toThrow(/records\.fields\._id\.storage\.kind is invalid/);
  });

  it("normalizes CMS role permissions with admin lockout protection", () => {
    const config = normalizeCmsConfig({
      version: 1,
      defaultAdapter: "memory",
      permissions: {
        schema: { refresh: ["editor"] },
      },
      collections: {
        records: {
          name: "records",
          permissions: {
            content: { update: ["editor"], delete: [] },
          },
          fields: [{ name: "_id", type: "id" }],
        },
      },
    });

    expect(config.permissions.schema?.refresh).toEqual(["editor", "admin"]);
    expect(config.collections.records.permissions?.content?.update).toEqual([
      "editor",
      "admin",
    ]);
    expect(config.collections.records.permissions?.content?.delete).toEqual([
      "admin",
    ]);
  });

  it("rejects invalid CMS permission roles", () => {
    expect(() =>
      normalizeCmsConfig({
        version: 1,
        defaultAdapter: "memory",
        permissions: { schema: { refresh: ["owner"] } },
        collections: {},
      }),
    ).toThrow(/permissions\.schema\.refresh has invalid role/);
  });

  it("keeps collection permissions as sparse overrides", () => {
    const config = normalizeCmsConfig({
      version: 1,
      defaultAdapter: "memory",
      permissions: {
        content: { update: ["editor"] },
      },
      collections: {
        records: {
          name: "records",
          fields: [{ name: "_id", type: "id" }],
        },
      },
    });

    expect(config.permissions.content?.update).toEqual(["editor", "admin"]);
    expect(config.collections.records.permissions).toBeUndefined();
  });
});
