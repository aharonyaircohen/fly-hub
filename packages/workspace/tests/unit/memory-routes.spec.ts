import type { Memory, MemoryRevision, MemoryStore } from "@kody-ade/memory";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setKodyRequestUserProvider } from "@kody-ade/base/auth/request-user-provider";

const { verifyRead, verifyWrite, store } = vi.hoisted(() => {
  const memories = new Map<string, Readonly<Memory>>();
  const revisions = new Map<string, Readonly<MemoryRevision>[]>();
  const store: MemoryStore = {
    async create(memory, revision) {
      memories.set(memory.id, memory);
      revisions.set(memory.id, [revision]);
    },
    async get(id) {
      return memories.get(id) ?? null;
    },
    async list(scopes) {
      return [...memories.values()].filter((memory) =>
        scopes.some((scope) =>
          scope.kind === "user" && memory.scope.kind === "user"
            ? scope.userId === memory.scope.userId
            : scope.kind === "repository" &&
              memory.scope.kind === "repository" &&
              scope.tenantId === memory.scope.tenantId,
        ),
      );
    },
    async listRevisions(memoryId) {
      return revisions.get(memoryId) ?? [];
    },
    async revise(memory, revision) {
      memories.set(memory.id, memory);
      revisions.set(memory.id, [...(revisions.get(memory.id) ?? []), revision]);
    },
    async remove(id) {
      revisions.delete(id);
      return memories.delete(id);
    },
  };
  return {
    verifyRead: vi.fn(),
    verifyWrite: vi.fn(),
    store,
  };
});

vi.mock("@kody-ade/base/auth", () => ({
  getRequestAuth: (request: NextRequest) => {
    const token = request.headers.get("x-kody-token");
    const owner = request.headers.get("x-kody-owner");
    const repo = request.headers.get("x-kody-repo");
    return token && owner && repo ? { token, owner, repo } : null;
  },
  verifyRepoReadAccess: verifyRead,
  verifyRepoWriteAccess: verifyWrite,
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: vi.fn(() => ({})),
}));
vi.mock("@kody-ade/backend/memory-store", () => ({
  createConvexMemoryStore: vi.fn(() => store),
}));

import {
  GET as listMemories,
  POST as createMemory,
} from "../../src/routes/memory";
import {
  DELETE as deleteMemory,
  GET as getMemory,
  PATCH as updateMemory,
} from "../../src/routes/memory-id";

const access = {
  auth: { owner: "acme", repo: "widgets", token: "secret" },
  actorLogin: "octocat",
  actorGithubId: 42,
  permission: "write",
  octokit: {},
};

function request(method: string, url: string, body?: Record<string, unknown>) {
  return new NextRequest(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
  });
}

async function body(response: NextResponse) {
  return (await response.json()) as Record<string, any>;
}

describe("memory routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setKodyRequestUserProvider(null);
    verifyRead.mockResolvedValue(access);
    verifyWrite.mockResolvedValue(access);
    for (const memory of await store.list([
      { kind: "user", userId: "github:42" },
      { kind: "repository", tenantId: "acme/widgets" },
    ])) {
      await store.remove(memory.id);
    }
  });

  it("uses Kody account ownership without requiring a repository", async () => {
    setKodyRequestUserProvider({
      resolveUser: vi.fn().mockResolvedValue({ id: "user-1", label: "Alice" }),
    });

    const created = await createMemory(
      request("POST", "http://localhost/api/kody/memory", {
        scope: "user",
        kind: "preference",
        title: "Reply style",
        summary: "Prefers short replies.",
        body: "Use simple words.",
      }),
    );

    expect(created.status).toBe(201);
    expect(await body(created)).toMatchObject({
      memory: { scope: { kind: "user", userId: "user-1" } },
    });
    expect(verifyWrite).not.toHaveBeenCalled();
  });

  it("adds verified repository memory without changing Kody account ownership", async () => {
    setKodyRequestUserProvider({
      resolveUser: vi.fn().mockResolvedValue({ id: "user-1", label: "Alice" }),
    });
    const repositoryRequest = new NextRequest(
      "http://localhost/api/kody/memory",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kody-token": "secret",
          "x-kody-owner": "acme",
          "x-kody-repo": "widgets",
        },
        body: JSON.stringify({
          scope: "repository",
          kind: "decision",
          title: "State owner",
          summary: "Convex owns runtime state.",
          body: "Do not use GitHub as a runtime fallback.",
        }),
      },
    );

    const created = await createMemory(repositoryRequest);

    expect(created.status).toBe(201);
    const createdBody = await body(created);
    expect(createdBody).toMatchObject({
      memory: {
        scope: { kind: "repository", tenantId: "acme/widgets" },
      },
    });
    const revisions = await store.listRevisions(createdBody.memory.id);
    expect(revisions[0]?.actor).toEqual({ kind: "user", id: "user-1" });
    expect(verifyWrite).toHaveBeenCalledOnce();
  });

  it("creates and lists a typed user memory", async () => {
    const created = await createMemory(
      request("POST", "http://localhost/api/kody/memory", {
        scope: "user",
        kind: "preference",
        title: "Reply style",
        summary: "Prefers short replies.",
        body: "Use simple words.",
      }),
    );

    expect(created.status).toBe(201);
    expect(await body(created)).toMatchObject({
      memory: {
        scope: { kind: "user", userId: "github:42" },
        kind: "preference",
        content: { title: "Reply style" },
      },
    });
    const listed = await listMemories(
      request("GET", "http://localhost/api/kody/memory"),
    );
    expect((await body(listed)).memories).toHaveLength(1);
  });

  it("lists only the explicitly requested memory scope", async () => {
    const headers = {
      "content-type": "application/json",
      "x-kody-token": "secret",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    };
    for (const scope of ["user", "repository"] as const) {
      await createMemory(
        new NextRequest("http://localhost/api/kody/memory", {
          method: "POST",
          headers,
          body: JSON.stringify({
            scope,
            kind: "fact",
            title: `${scope} fact`,
            summary: `${scope} summary`,
            body: `${scope} body`,
          }),
        }),
      );
    }

    const listed = await listMemories(
      new NextRequest("http://localhost/api/kody/memory?scope=repository", {
        headers,
      }),
    );
    expect((await body(listed)).memories).toEqual([
      expect.objectContaining({
        scope: { kind: "repository", tenantId: "acme/widgets" },
      }),
    ]);
  });

  it("reads, revises, and returns revision history", async () => {
    const createdResponse = await createMemory(
      request("POST", "http://localhost/api/kody/memory", {
        scope: "repository",
        kind: "decision",
        title: "State owner",
        summary: "Convex owns runtime state.",
        body: "Do not use GitHub as a runtime fallback.",
      }),
    );
    const created = (await body(createdResponse)).memory as Memory;
    const params = { params: Promise.resolve({ id: created.id }) };

    const updated = await updateMemory(
      request("PATCH", `http://localhost/api/kody/memory/${created.id}`, {
        summary: "Convex alone owns runtime state.",
        reason: "Clarified the approved decision.",
      }),
      params,
    );
    expect(await body(updated)).toMatchObject({
      memory: {
        content: { summary: "Convex alone owns runtime state." },
      },
    });

    const fetched = await getMemory(
      request("GET", `http://localhost/api/kody/memory/${created.id}`),
      params,
    );
    expect((await body(fetched)).revisions).toHaveLength(2);
  });

  it("deletes without requiring GitHub file access", async () => {
    const createdResponse = await createMemory(
      request("POST", "http://localhost/api/kody/memory", {
        scope: "user",
        kind: "fact",
        title: "Temporary",
        summary: "Temporary fact.",
        body: "Remove this.",
      }),
    );
    const created = (await body(createdResponse)).memory as Memory;
    const response = await deleteMemory(
      request("DELETE", `http://localhost/api/kody/memory/${created.id}`),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ deleted: true });
  });

  it("rejects invalid input and hides inaccessible ids", async () => {
    const invalid = await createMemory(
      request("POST", "http://localhost/api/kody/memory", {
        scope: "user",
        kind: "feedback",
      }),
    );
    expect(invalid.status).toBe(400);

    const missing = await getMemory(
      request("GET", "http://localhost/api/kody/memory/missing"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(missing.status).toBe(404);
  });

  it("returns auth failures unchanged", async () => {
    verifyRead.mockResolvedValueOnce(
      NextResponse.json({ error: "read_permission_required" }, { status: 403 }),
    );
    const response = await listMemories(
      request("GET", "http://localhost/api/kody/memory"),
    );
    expect(response.status).toBe(403);
  });
});
