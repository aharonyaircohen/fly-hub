import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_viewer",
    owner: "acme",
    repo: "widgets",
  })),
  getUserOctokit: vi.fn(async () => ({ marker: "viewer-octokit" })),
}));

const stateRepo = vi.hoisted(() => ({
  deleteStateDirectory: vi.fn(async () => ({ deleted: 2 })),
  resolveStateRepo: vi.fn(),
  stateRepoPath: vi.fn(),
  writeStateBase64Files: vi.fn(async () => ({
    sha: "commit-sha",
    branch: "main",
    target: { owner: "octo-state", repo: "backend-store", basePath: "widgets" },
  })),
}));
const backend = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoReadAccess: auth.requireKodyAuth,
  verifyRepoWriteAccess: auth.requireKodyAuth,
  requireKodyAuth: auth.requireKodyAuth,
  getRequestAuth: auth.getRequestAuth,
  getUserOctokit: auth.getUserOctokit,
}));

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { DELETE, POST } from "../../app/api/kody/views/route";

beforeEach(() => {
  vi.clearAllMocks();
  backend.mutation.mockResolvedValue(undefined);
  stateRepo.stateRepoPath.mockImplementation(
    (target: { basePath: string }, path: string) =>
      [target.basePath, path].filter(Boolean).join("/"),
  );
});

describe("POST /api/kody/views", () => {
  it("writes uploaded view files to Convex", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["<h1>Hello</h1>"], "hello.html", { type: "text/html" }),
    );

    const res = await POST(
      new NextRequest("http://localhost/api/kody/views", {
        method: "POST",
        body: form,
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      url: string;
      repoPath: string;
      entryPath: string;
      htmlUrl: string;
      sourceHtmlUrl: string;
    };
    expect(body.url).toMatch(
      /^\/api\/kody\/views\/hello-html-[a-f0-9]{8}\/index\.html$/,
    );
    expect(body.repoPath).toMatch(/^views\/hello-html-[a-f0-9]{8}$/);
    expect(body.entryPath).toBe("index.html");
    expect(body.htmlUrl).toBeNull();
    expect(body.sourceHtmlUrl).toBeNull();
    expect(backend.mutation).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "acme/widgets",
      kind: expect.stringMatching(/^views\/hello-html-[a-f0-9]{8}$/),
      doc: expect.objectContaining({
        files: {
          "index.html": Buffer.from("<h1>Hello</h1>").toString("base64"),
        },
      }),
      updatedAt: expect.any(String),
    });
  });
});

describe("DELETE /api/kody/views", () => {
  it("deletes the view document from Convex", async () => {
    const res = await DELETE(
      new NextRequest("http://localhost/api/kody/views?view=mobile-html-1234", {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(backend.mutation).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "acme/widgets",
      kind: "views/mobile-html-1234",
    });
  });

  it("rejects unsafe view ids", async () => {
    const res = await DELETE(
      new NextRequest("http://localhost/api/kody/views?view=../bad", {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(400);
    expect(stateRepo.deleteStateDirectory).not.toHaveBeenCalled();
  });
});
