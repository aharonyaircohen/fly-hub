import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({ owner: "acme", repo: "widgets" })),
  getUserOctokit: vi.fn(),
}));

const store = vi.hoisted(() => ({
  readDashboardConfig: vi.fn(async () => ({
    doc: { version: 1 } as {
      version: number;
      fileSpaces?: Array<{
        id: string;
        title: string;
        slug: string;
        rootPath: string;
      }>;
    },
    sha: null,
  })),
  writeDashboardConfig: vi.fn(),
  invalidateDashboardConfigCache: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@dashboard/lib/dashboard-config/store", () => store);
vi.mock("@kody-ade/base/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { DELETE, GET, PATCH, POST, PUT } from "../../app/api/kody/file-spaces/route";

beforeEach(() => {
  vi.clearAllMocks();
  auth.getRequestAuth.mockReturnValue({ owner: "acme", repo: "widgets" });
  auth.getUserOctokit.mockResolvedValue({
    repos: {
      getContent: vi.fn().mockRejectedValue({ status: 404 }),
      createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
    },
  });
  store.readDashboardConfig.mockResolvedValue({
    doc: { version: 1 },
    sha: null,
  });
});

describe("/api/kody/file-spaces", () => {
  it("lists the built-in Docs space", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/kody/file-spaces"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      spaces: [{ id: "docs", title: "Docs", builtIn: true }],
    });
  });

  it("creates the repository folder before saving the custom space", async () => {
    const octokit = await auth.getUserOctokit();
    auth.getUserOctokit.mockResolvedValue(octokit);
    const response = await POST(
      new NextRequest("http://localhost/api/kody/file-spaces", {
        method: "POST",
        body: JSON.stringify({ title: "Notes" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(octokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        path: "notes/.gitkeep",
      }),
    );
    expect(store.writeDashboardConfig).toHaveBeenCalledWith(
      "acme",
      "widgets",
      expect.objectContaining({
        fileSpaces: [expect.objectContaining({ slug: "notes" })],
      }),
    );
  });

  it("renames a custom space without changing its route or folder", async () => {
    store.readDashboardConfig.mockResolvedValueOnce({
      doc: {
        version: 1,
        fileSpaces: [
          { id: "notes", title: "Notes", slug: "notes", rootPath: "notes" },
        ],
      },
      sha: null,
    });

    const response = await PATCH(
      new NextRequest("http://localhost/api/kody/file-spaces", {
        method: "PATCH",
        body: JSON.stringify({ id: "notes", title: "Research" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(store.writeDashboardConfig).toHaveBeenCalledWith(
      "acme",
      "widgets",
      expect.objectContaining({
        fileSpaces: [
          expect.objectContaining({
            title: "Research",
            slug: "notes",
            rootPath: "notes",
          }),
        ],
      }),
    );
  });

  it("removes configuration without deleting repository content", async () => {
    store.readDashboardConfig.mockResolvedValueOnce({
      doc: {
        version: 1,
        fileSpaces: [
          { id: "notes", title: "Notes", slug: "notes", rootPath: "notes" },
        ],
      },
      sha: null,
    });

    const response = await DELETE(
      new NextRequest("http://localhost/api/kody/file-spaces?id=notes", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    expect(store.writeDashboardConfig).toHaveBeenCalledWith(
      "acme",
      "widgets",
      expect.objectContaining({ fileSpaces: [] }),
    );
    expect(auth.getUserOctokit).not.toHaveBeenCalled();
  });

  it("persists the requested custom space order", async () => {
    store.readDashboardConfig.mockResolvedValueOnce({
      doc: {
        version: 1,
        fileSpaces: [
          { id: "notes", title: "Notes", slug: "notes", rootPath: "notes" },
          { id: "ideas", title: "Ideas", slug: "ideas", rootPath: "ideas" },
        ],
      },
      sha: null,
    });

    const response = await PUT(
      new NextRequest("http://localhost/api/kody/file-spaces", {
        method: "PUT",
        body: JSON.stringify({ ids: ["ideas", "notes"] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(store.writeDashboardConfig).toHaveBeenCalledWith(
      "acme",
      "widgets",
      expect.objectContaining({
        fileSpaces: [
          expect.objectContaining({ id: "ideas" }),
          expect.objectContaining({ id: "notes" }),
        ],
      }),
    );
  });

  it("reports storage failures as server errors when reordering", async () => {
    store.readDashboardConfig.mockResolvedValueOnce({
      doc: {
        version: 1,
        fileSpaces: [
          { id: "notes", title: "Notes", slug: "notes", rootPath: "notes" },
        ],
      },
      sha: null,
    });
    store.writeDashboardConfig.mockRejectedValueOnce(new Error("Convex unavailable"));

    const response = await PUT(
      new NextRequest("http://localhost/api/kody/file-spaces", {
        method: "PUT",
        body: JSON.stringify({ ids: ["notes"] }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: "Failed to save file space order",
    });
  });
});
