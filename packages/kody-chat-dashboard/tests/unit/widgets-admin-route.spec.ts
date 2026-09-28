/**
 * Widgets admin route: header auth, per-tenant list (metadata only),
 * publish with version bump, slug/bundle validation errors, backend
 * failure mapping.
 *
 * @testFramework vitest
 * @domain unit
 */
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => {
  const getRequestAuth = vi.fn((req: NextRequest) => {
    const token = req.headers.get("x-kody-token");
    const owner = req.headers.get("x-kody-owner");
    const repo = req.headers.get("x-kody-repo");
    if (!token || !owner || !repo) return null;
    return { token, owner, repo };
  });
  return {
    getRequestAuth,
    requireKodyAuth: vi.fn(async (req: NextRequest) =>
      getRequestAuth(req)
        ? null
        : NextResponse.json({ message: "Not authenticated." }, { status: 401 }),
    ),
  };
});

const store = vi.hoisted(() => ({
  rows: [] as Array<{
    tenantId: string;
    name?: string;
    slug: string;
    version: number;
    bundleSize: number;
    commitSha?: string;
    updatedAt: string;
  }>,
  fail: false,
  queries: [] as Array<Record<string, unknown>>,
  mutations: [] as Array<Record<string, unknown>>,
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@kody-ade/backend/api", () => ({
  api: { widgets: { list: "widgets.list", publish: "widgets.publish" } },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: async (operation: string, args: Record<string, unknown>) => {
      if (store.fail) throw new Error("backend unavailable");
      expect(operation).toBe("widgets.list");
      store.queries.push({ ...args });
      return store.rows.filter((row) => row.tenantId === args.tenantId);
    },
    mutation: async (operation: string, args: Record<string, unknown>) => {
      if (store.fail) throw new Error("backend unavailable");
      expect(operation).toBe("widgets.publish");
      store.mutations.push({ ...args });
      const existing = store.rows.filter(
        (row) => row.tenantId === args.tenantId && row.slug === args.slug,
      );
      return existing.reduce((max, row) => Math.max(max, row.version), 0) + 1;
    },
  }),
}));

import { GET, POST } from "../../app/api/kody/widgets/route";

const AUTH_HEADERS = {
  "x-kody-token": "tok",
  "x-kody-owner": "acme",
  "x-kody-repo": "site",
};

function getRequest(headers: Record<string, string> = AUTH_HEADERS) {
  return new NextRequest("https://dash.test/api/kody/widgets", { headers });
}

function postRequest(
  body: unknown,
  headers: Record<string, string> = AUTH_HEADERS,
) {
  return new NextRequest("https://dash.test/api/kody/widgets", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store.rows = [];
  store.fail = false;
  store.queries = [];
  store.mutations = [];
  vi.clearAllMocks();
});

describe("GET /api/kody/widgets", () => {
  it("401s without auth headers", async () => {
    const res = await GET(getRequest({}));
    expect(res.status).toBe(401);
  });

  it("lists the tenant's widgets only", async () => {
    store.rows = [
      {
        tenantId: "acme/site",
        name: "Quiz",
        slug: "quiz",
        version: 3,
        bundleSize: 1200,
        commitSha: "abc123",
        updatedAt: "2026-07-22T00:00:00.000Z",
      },
      {
        tenantId: "other/repo",
        slug: "poll",
        version: 1,
        bundleSize: 10,
        updatedAt: "2026-07-22T00:00:00.000Z",
      },
    ];
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const json = (await res.json()) as {
      widgets: Array<{ name: string; slug: string }>;
    };
    expect(json.widgets).toHaveLength(1);
    expect(json.widgets[0]).toMatchObject({ name: "Quiz", slug: "quiz" });
    expect(store.queries).toEqual([{ tenantId: "acme/site" }]);
  });

  it("500s when the backend fails", async () => {
    store.fail = true;
    const res = await GET(getRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "widgets_unavailable" });
  });
});

describe("POST /api/kody/widgets", () => {
  it("401s without auth headers", async () => {
    const res = await POST(postRequest({ slug: "quiz", bundle: "x" }, {}));
    expect(res.status).toBe(401);
    expect(store.mutations).toHaveLength(0);
  });

  it("derives the slug from the widget name and returns both identities", async () => {
    store.rows = [
      {
        tenantId: "acme/site",
        slug: "quiz",
        version: 2,
        bundleSize: 5,
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    ];
    const res = await POST(
      postRequest({
        name: "Question Select",
        bundle: "export{}",
        commitSha: "deadbeef",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "Question Select",
      slug: "question-select",
      version: 1,
    });
    expect(store.mutations).toHaveLength(1);
    expect(store.mutations[0]).toMatchObject({
      tenantId: "acme/site",
      slug: "question-select",
      bundle: "export{}",
      commitSha: "deadbeef",
    });
    expect(store.mutations[0]).not.toHaveProperty("name");
    expect(typeof store.mutations[0].updatedAt).toBe("string");
  });

  it("omits commitSha from the publish when not provided", async () => {
    const res = await POST(postRequest({ slug: "quiz", bundle: "x" }));
    expect(res.status).toBe(200);
    expect(store.mutations[0]).toMatchObject({
      slug: "quiz",
    });
    expect(store.mutations[0]).not.toHaveProperty("name");
    expect(store.mutations[0]).not.toHaveProperty("commitSha");
  });

  it("400s when neither a widget name nor legacy slug is provided", async () => {
    const res = await POST(postRequest({ bundle: "x" }));
    expect(res.status).toBe(400);
    expect(store.mutations).toHaveLength(0);
  });

  it("400s on an invalid slug", async () => {
    const res = await POST(postRequest({ slug: "Bad Slug!", bundle: "x" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid_widget");
    expect(store.mutations).toHaveLength(0);
  });

  it("400s on an empty bundle", async () => {
    const res = await POST(postRequest({ slug: "quiz", bundle: "" }));
    expect(res.status).toBe(400);
    expect(store.mutations).toHaveLength(0);
  });

  it("400s when the bundle exceeds the size cap", async () => {
    const res = await POST(
      postRequest({ slug: "quiz", bundle: "x".repeat(900_001) }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { message?: string };
    expect(json.message).toContain("900000");
    expect(store.mutations).toHaveLength(0);
  });

  it("400s on a non-JSON body", async () => {
    const res = await POST(
      new NextRequest("https://dash.test/api/kody/widgets", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(store.mutations).toHaveLength(0);
  });

  it("500s when the publish mutation fails", async () => {
    store.fail = true;
    const res = await POST(postRequest({ slug: "quiz", bundle: "x" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "widget_publish_failed" });
  });
});
