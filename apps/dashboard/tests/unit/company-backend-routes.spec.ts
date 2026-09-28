import { gzipSync } from "node:zlib";

import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  verifyRepoReadAccess: vi.fn(async () => ({
    auth: {
      token: "ghp_test",
      owner: "acme",
      repo: "widgets",
    },
    actorLogin: "alice",
  })),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "widgets",
  })),
  getUserOctokit: vi.fn(),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "alice", avatar_url: "u", githubId: 1 },
  })),
}));

const githubClient = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

const stateRepo = vi.hoisted(() => ({
  resolveStateRepo: vi.fn(),
}));

const convex = vi.hoisted(() => {
  const mutation = vi.fn(
    async (_ref: unknown, _args: Record<string, unknown>) => null,
  );
  const query = vi.fn(
    async (
      _ref: unknown,
      _args: Record<string, unknown>,
    ): Promise<Array<Record<string, unknown>>> => [],
  );
  return {
    mutation,
    query,
    ConvexHttpClient: vi.fn(function ConvexHttpClient() {
      return { mutation, query };
    }),
  };
});

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoWriteAccess: auth.requireKodyAuth,
  requireKodyAuth: auth.requireKodyAuth,
  verifyRepoReadAccess: auth.verifyRepoReadAccess,
  getRequestAuth: auth.getRequestAuth,
  getUserOctokit: auth.getUserOctokit,
  verifyActorLogin: auth.verifyActorLogin,
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: githubClient.setGitHubContext,
  clearGitHubContext: githubClient.clearGitHubContext,
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: convex.ConvexHttpClient,
}));

import { GET as EXPORT } from "../../app/api/kody/company/backend/export/route";
import { POST as IMPORT } from "../../app/api/kody/company/backend/import/route";

function req(path: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(`https://dash.test${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "x-kody-token": "ghp_test",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
  });
}

/** Build one 512-byte ustar header + padded content for a regular file. */
function tarFile(name: string, content: string): Buffer {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "utf8"); // mode
  header.write("0000000\0", 108, 8, "utf8"); // uid
  header.write("0000000\0", 116, 8, "utf8"); // gid
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12);
  header.write("00000000000\0", 136, 12, "utf8"); // mtime
  header.write("        ", 148, 8, "utf8"); // checksum placeholder
  header.write("0", 156, 1, "utf8"); // typeflag: regular file
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}

/** Build a gzipped tarball like GitHub's downloadTarballArchive returns. */
function tarball(files: Record<string, string>): ArrayBuffer {
  const blocks = Object.entries(files).map(([name, content]) =>
    tarFile(name, content),
  );
  const gz = gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
  return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
}

function octokitWithTarball(data: ArrayBuffer) {
  return {
    rest: {
      repos: {
        downloadTarballArchive: vi.fn(async () => ({ data })),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  convex.mutation.mockImplementation(async () => null);
  convex.query.mockImplementation(async () => []);
  auth.requireKodyAuth.mockResolvedValue(null);
  auth.verifyRepoReadAccess.mockResolvedValue({
    auth: {
      token: "ghp_test",
      owner: "acme",
      repo: "widgets",
    },
    actorLogin: "alice",
  });
  auth.getRequestAuth.mockReturnValue({
    token: "ghp_test",
    owner: "acme",
    repo: "widgets",
  });
  auth.getUserOctokit.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/kody/company/backend/export", () => {
  it("exports every importable table from Convex as a downloadable dump", async () => {
    vi.stubEnv("CONVEX_URL", "https://demo.convex.cloud");
    convex.query.mockImplementation(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (args.table === "workflows") {
          return [{ tenantId: args.tenantId, workflowId: "bug" }];
        }
        if (args.table === "repoDocs") {
          return [{ tenantId: args.tenantId, kind: "todo:one", doc: {} }];
        }
        return [];
      },
    );

    const res = await EXPORT(req("/api/kody/company/backend/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");

    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.tenantId).toBe("acme/widgets");
    expect(body.skipped).toBe(0);
    expect(body.failures).toEqual([]);
    // Every table was queried with the tenant filter…
    const queriedTables = convex.query.mock.calls.map(
      (call) => (call[1] as { table: string }).table,
    );
    expect(queriedTables).toContain("workflows");
    expect(queriedTables).toContain("repoDocs");
    expect(
      convex.query.mock.calls.every(
        (call) => (call[1] as { tenantId: string }).tenantId === "acme/widgets",
      ),
    ).toBe(true);
    expect(queriedTables).not.toContain("userPreferences");
    expect(queriedTables).not.toContain("actionStates");
    expect(queriedTables).not.toContain("eventLog");
    // …but only non-empty ones land in the dump.
    expect(body.tables).toEqual({
      workflows: [{ tenantId: "acme/widgets", workflowId: "bug" }],
      repoDocs: [{ tenantId: "acme/widgets", kind: "todo:one", doc: {} }],
    });
    // Convex export never touches GitHub.
    expect(auth.verifyRepoReadAccess).toHaveBeenCalled();
    expect(stateRepo.resolveStateRepo).not.toHaveBeenCalled();
  });

  it("records per-table failures without failing the whole export", async () => {
    vi.stubEnv("CONVEX_URL", "https://demo.convex.cloud");
    convex.query.mockImplementation(
      async (_ref: unknown, args: Record<string, unknown>) => {
        if (args.table === "repoDocs") throw new Error("boom");
        if (args.table === "workflows") {
          return [{ tenantId: args.tenantId, workflowId: "bug" }];
        }
        return [];
      },
    );

    const res = await EXPORT(req("/api/kody/company/backend/export"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.failures).toEqual(["repoDocs"]);
    expect(body.tables.workflows).toHaveLength(1);
  });

  it("returns 400 when CONVEX_URL is not configured", async () => {
    vi.stubEnv("CONVEX_URL", "");
    const res = await EXPORT(req("/api/kody/company/backend/export"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("convex_url_not_configured");
    expect(convex.query).not.toHaveBeenCalled();
  });

  it("returns the repository access failure response when access is rejected", async () => {
    const denied = NextResponse.json(
      { error: "unauthorized" },
      { status: 401 },
    );
    auth.verifyRepoReadAccess.mockResolvedValue(denied as never);

    const res = await EXPORT(req("/api/kody/company/backend/export"));
    expect(res.status).toBe(401);
    expect(convex.query).not.toHaveBeenCalled();
  });
});

describe("POST /api/kody/company/backend/import", () => {
  const dump = {
    version: 1,
    tenantId: "acme/widgets",
    tables: {
      workflows: [{ tenantId: "acme/widgets", workflowId: "bug" }],
      repoDocs: Array.from({ length: 250 }, (_, i) => ({
        tenantId: "acme/widgets",
        kind: `todo:${i}`,
        doc: {},
      })),
    },
  };

  it("imports each table in chunks and reports counts", async () => {
    vi.stubEnv("CONVEX_URL", "https://demo.convex.cloud");

    const res = await IMPORT(
      req("/api/kody/company/backend/import", "POST", {
        ...dump,
        clearFirst: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      cleared: true,
      imported: { workflows: 1, repoDocs: 250 },
    });

    // clearRepo + 1 workflows chunk + 5 repoDocs chunks (250 docs, size 50)
    expect(convex.mutation).toHaveBeenCalledTimes(7);
    expect(convex.mutation.mock.calls[0][1]).toEqual({
      tenantId: "acme/widgets",
    });
    const todoChunks = convex.mutation.mock.calls
      .slice(1)
      .filter((call) => (call[1] as { table: string }).table === "repoDocs")
      .map((call) => (call[1] as { docs: unknown[] }).docs.length);
    expect(todoChunks).toEqual([50, 50, 50, 50, 50]);
  });

  it("imports every document into the selected repo, not the dump's source repo", async () => {
    vi.stubEnv("CONVEX_URL", "https://demo.convex.cloud");

    const res = await IMPORT(
      req("/api/kody/company/backend/import", "POST", {
        ...dump,
        tenantId: "other/source",
        clearFirst: true,
        tables: {
          workflows: [
            { tenantId: "other/source", workflowId: "bug" },
            { tenantId: "third/repo", workflowId: "feature" },
          ],
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(convex.mutation.mock.calls[0][1]).toEqual({
      tenantId: "acme/widgets",
    });
    expect(convex.mutation.mock.calls[1][1]).toEqual({
      table: "workflows",
      docs: [
        { tenantId: "acme/widgets", workflowId: "bug" },
        { tenantId: "acme/widgets", workflowId: "feature" },
      ],
    });
  });

  it("rejects global tables that are not owned by the selected repo", async () => {
    vi.stubEnv("CONVEX_URL", "https://demo.convex.cloud");

    const res = await IMPORT(
      req("/api/kody/company/backend/import", "POST", {
        ...dump,
        tables: {
          userPreferences: [{ namespace: "nav", userKey: "alice" }],
        },
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("non_repo_table");
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("retries a chunk when Convex throttles writes, then succeeds", async () => {
    vi.stubEnv("CONVEX_URL", "https://demo.convex.cloud");
    convex.mutation
      .mockRejectedValueOnce(
        new Error(
          '{"code":"TooManyWrites","message":"Too many writes per second."}',
        ),
      )
      .mockRejectedValueOnce(
        new Error(
          '{"code":"TooManyWrites","message":"Too many writes per second."}',
        ),
      );

    const res = await IMPORT(
      req("/api/kody/company/backend/import", "POST", {
        ...dump,
        tables: { workflows: dump.tables.workflows },
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).imported).toEqual({ workflows: 1 });
    // 2 throttled attempts + 1 success for the single chunk
    expect(convex.mutation).toHaveBeenCalledTimes(3);
  });

  it("gives up after exhausting retries on persistent throttling", async () => {
    vi.stubEnv("CONVEX_URL", "https://demo.convex.cloud");
    vi.useFakeTimers();
    convex.mutation.mockRejectedValue(
      new Error(
        '{"code":"TooManyWrites","message":"Too many writes per second."}',
      ),
    );

    try {
      const pending = IMPORT(
        req("/api/kody/company/backend/import", "POST", {
          ...dump,
          tables: { workflows: dump.tables.workflows },
        }),
      );
      await vi.runAllTimersAsync();
      const res = await pending;
      expect(res.status).toBe(500);
      expect((await res.json()).message).toContain("TooManyWrites");
      // initial attempt + MAX_RETRIES (5)
      expect(convex.mutation).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry non-throttle errors", async () => {
    vi.stubEnv("CONVEX_URL", "https://demo.convex.cloud");
    convex.mutation.mockRejectedValue(new Error("schema validation failed"));

    const res = await IMPORT(
      req("/api/kody/company/backend/import", "POST", {
        ...dump,
        tables: { workflows: dump.tables.workflows },
      }),
    );
    expect(res.status).toBe(500);
    expect(convex.mutation).toHaveBeenCalledTimes(1);
  });

  it("skips clearRepo when clearFirst is not set", async () => {
    vi.stubEnv("CONVEX_URL", "https://demo.convex.cloud");

    const res = await IMPORT(
      req("/api/kody/company/backend/import", "POST", {
        ...dump,
        tables: { workflows: dump.tables.workflows },
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).cleared).toBe(false);
    expect(convex.mutation).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when CONVEX_URL is not configured", async () => {
    vi.stubEnv("CONVEX_URL", "");

    const res = await IMPORT(
      req("/api/kody/company/backend/import", "POST", dump),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("convex_url_not_configured");
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body", async () => {
    vi.stubEnv("CONVEX_URL", "https://demo.convex.cloud");

    const res = await IMPORT(
      req("/api/kody/company/backend/import", "POST", {
        version: 2,
        tables: "nope",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("returns the auth failure response when auth is rejected", async () => {
    const denied = NextResponse.json(
      { error: "unauthorized" },
      { status: 401 },
    );
    auth.requireKodyAuth.mockResolvedValue(denied as never);

    const res = await IMPORT(
      req("/api/kody/company/backend/import", "POST", dump),
    );
    expect(res.status).toBe(401);
    expect(convex.mutation).not.toHaveBeenCalled();
  });
});
