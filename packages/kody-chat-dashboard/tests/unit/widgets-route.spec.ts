/**
 * Widget bundle serving route: header/query auth, latest-version lookup,
 * text/javascript content type, version-keyed ETag revalidation, 404 when
 * the tenant has no widget for the slug.
 *
 * @testFramework vitest
 * @domain unit
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getRequestAuth: vi.fn((req: NextRequest) => {
    const token = req.headers.get("x-kody-token");
    const owner = req.headers.get("x-kody-owner");
    const repo = req.headers.get("x-kody-repo");
    if (!token || !owner || !repo) return null;
    return { token, owner, repo };
  }),
  requireKodyAuth: vi.fn(async () => null),
}));

const store = vi.hoisted(() => ({
  rows: [] as Array<{
    tenantId: string;
    slug: string;
    version: number;
    bundle: string;
    updatedAt: string;
  }>,
  failQueries: false,
  queries: [] as Array<Record<string, unknown>>,
  mutations: [] as Array<Record<string, unknown>>,
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    widgets: {
      latest: "widgets.latest",
      getVersion: "widgets.getVersion",
      remove: "widgets.remove",
    },
  },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: async (operation: string, args: Record<string, unknown>) => {
      if (store.failQueries) throw new Error("backend unavailable");
      store.queries.push({ ...args });
      const matches = store.rows.filter(
        (row) =>
          row.tenantId === args.tenantId &&
          row.slug === args.slug &&
          (operation !== "widgets.getVersion" || row.version === args.version),
      );
      return (
        matches.reduce<(typeof matches)[number] | null>(
          (best, row) => (!best || row.version > best.version ? row : best),
          null,
        ) ?? null
      );
    },
    mutation: async (operation: string, args: Record<string, unknown>) => {
      if (store.failQueries) throw new Error("backend unavailable");
      expect(operation).toBe("widgets.remove");
      store.mutations.push({ ...args });
      const before = store.rows.length;
      store.rows = store.rows.filter(
        (row) => row.tenantId !== args.tenantId || row.slug !== args.slug,
      );
      return before - store.rows.length;
    },
  }),
}));

import { DELETE, GET } from "../../app/api/kody/widgets/[slug]/route";

function headerRequest(
  slug: string,
  headers: Record<string, string> = {
    "x-kody-token": "tok",
    "x-kody-owner": "acme",
    "x-kody-repo": "site",
  },
): [NextRequest, { params: Promise<{ slug: string }> }] {
  return [
    new NextRequest(`https://dash.test/api/kody/widgets/${slug}`, { headers }),
    { params: Promise.resolve({ slug }) },
  ];
}

function queryRequest(
  slug: string,
  query: string,
): [NextRequest, { params: Promise<{ slug: string }> }] {
  return [
    new NextRequest(`https://dash.test/api/kody/widgets/${slug}?${query}`),
    { params: Promise.resolve({ slug }) },
  ];
}

beforeEach(() => {
  store.rows = [];
  store.failQueries = false;
  store.queries = [];
  store.mutations = [];
});

describe("GET /api/kody/widgets/[slug]", () => {
  it("serves the tenant's latest bundle as JavaScript with a version ETag", async () => {
    store.rows = [
      {
        tenantId: "acme/site",
        slug: "quiz",
        version: 1,
        bundle: "export default () => {}; // v1",
        updatedAt: "2026-07-20T00:00:00.000Z",
      },
      {
        tenantId: "acme/site",
        slug: "quiz",
        version: 2,
        bundle: "export default () => {}; // v2",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    ];
    const res = await GET(...headerRequest("quiz"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(res.headers.get("etag")).toBe('"widget-quiz-v2"');
    expect(res.headers.get("cache-control")).toContain("must-revalidate");
    expect(await res.text()).toBe("export default () => {}; // v2");
    expect(store.queries).toEqual([{ tenantId: "acme/site", slug: "quiz" }]);
  });

  it("accepts owner/repo/token as query params (dynamic import cannot set headers)", async () => {
    store.rows = [
      {
        tenantId: "acme/site",
        slug: "quiz",
        version: 1,
        bundle: "export default () => {};",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    ];
    const res = await GET(
      ...queryRequest("quiz", "owner=acme&repo=site&token=tok"),
    );
    expect(res.status).toBe(200);
    expect(store.queries).toEqual([{ tenantId: "acme/site", slug: "quiz" }]);
  });

  it("serves the exact widget version pinned by a renderer", async () => {
    store.rows = [
      {
        tenantId: "acme/site",
        slug: "quiz",
        version: 1,
        bundle: "export default () => {}; // v1",
        updatedAt: "2026-07-20T00:00:00.000Z",
      },
      {
        tenantId: "acme/site",
        slug: "quiz",
        version: 2,
        bundle: "export default () => {}; // v2",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    ];
    const res = await GET(
      ...queryRequest("quiz", "owner=acme&repo=site&token=tok&version=1"),
    );

    expect(await res.text()).toContain("v1");
    expect(store.queries).toEqual([
      { tenantId: "acme/site", slug: "quiz", version: 1 },
    ]);
  });

  it("returns 304 when If-None-Match carries the current version ETag", async () => {
    store.rows = [
      {
        tenantId: "acme/site",
        slug: "quiz",
        version: 3,
        bundle: "export default () => {};",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    ];
    const res = await GET(
      ...headerRequest("quiz", {
        "x-kody-token": "tok",
        "x-kody-owner": "acme",
        "x-kody-repo": "site",
        "if-none-match": '"widget-quiz-v3"',
      }),
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("returns 404 JSON when the tenant has no widget for the slug", async () => {
    const res = await GET(...headerRequest("quiz"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "widget_not_found" });
  });

  it("does not serve another tenant's widget", async () => {
    store.rows = [
      {
        tenantId: "other/repo",
        slug: "quiz",
        version: 1,
        bundle: "export default () => {};",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    ];
    const res = await GET(...headerRequest("quiz"));
    expect(res.status).toBe(404);
  });

  it("returns 401 without header or query auth", async () => {
    const res = await GET(...headerRequest("quiz", {}));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_authenticated");
  });

  it("returns 401 when query auth is incomplete", async () => {
    const res = await GET(...queryRequest("quiz", "owner=acme&repo=site"));
    expect(res.status).toBe(401);
  });

  it("rejects invalid slugs before touching the backend", async () => {
    const res = await GET(...headerRequest("Not%20A%20Slug"));
    expect(res.status).toBe(400);
    expect(store.queries).toEqual([]);
  });

  it("returns 500 JSON when the backend query fails", async () => {
    store.failQueries = true;
    const res = await GET(...headerRequest("quiz"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("widget_unavailable");
  });
});

describe("DELETE /api/kody/widgets/[slug]", () => {
  it("deletes every version only inside the authenticated tenant", async () => {
    store.rows = [
      {
        tenantId: "acme/site",
        slug: "quiz",
        version: 1,
        bundle: "v1",
        updatedAt: "now",
      },
      {
        tenantId: "acme/site",
        slug: "quiz",
        version: 2,
        bundle: "v2",
        updatedAt: "now",
      },
      {
        tenantId: "other/repo",
        slug: "quiz",
        version: 1,
        bundle: "other",
        updatedAt: "now",
      },
    ];
    const res = await DELETE(...headerRequest("quiz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "quiz", deletedVersions: 2 });
    expect(store.mutations).toEqual([{ tenantId: "acme/site", slug: "quiz" }]);
    expect(store.rows).toHaveLength(1);
  });

  it("returns 404 when the tenant does not own the widget", async () => {
    const res = await DELETE(...headerRequest("quiz"));
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await DELETE(...headerRequest("quiz", {}));
    expect(res.status).toBe(401);
    expect(store.mutations).toHaveLength(0);
  });
});
