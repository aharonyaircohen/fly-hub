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
  verifyActorLogin: vi.fn(),
}));

const backgroundToken = vi.hoisted(() => ({
  resolveBackgroundToken: vi.fn(
    async (): Promise<{ token: string; source: "app" } | null> => ({
      token: "ghs_app_token",
      source: "app" as const,
    }),
  ),
}));

const githubClient = vi.hoisted(() => ({
  createUserOctokit: vi.fn(() => ({ marker: "app-octokit" })),
}));

const store = vi.hoisted(() => ({
  invalidateDashboardConfigCache: vi.fn(),
  readDashboardConfig: vi.fn(async () => ({
    doc: {
      version: 1,
      defaultPreviewUrl: undefined as string | undefined,
      namedPreviews: [] as Array<Record<string, unknown>>,
    },
    sha: "sha-1",
  })),
  writeDashboardConfig: vi.fn(),
}));

const stateRepo = vi.hoisted(() => ({
  resolveStateRepo: vi.fn(async () => ({
    owner: "acme-state",
    repo: "backend-store",
    basePath: "widgets",
    branch: "main",
  })),
  stateRepoPath: vi.fn((target: { basePath: string }, path: string) =>
    [target.basePath, path].filter(Boolean).join("/"),
  ),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: auth.requireKodyAuth,
  getRequestAuth: auth.getRequestAuth,
  getUserOctokit: auth.getUserOctokit,
  verifyActorLogin: auth.verifyActorLogin,
}));

vi.mock("@kody-ade/base/auth/background-token", () => ({
  resolveBackgroundToken: backgroundToken.resolveBackgroundToken,
}));

vi.mock("@dashboard/lib/github-client", () => ({
  createUserOctokit: githubClient.createUserOctokit,
}));

vi.mock("@dashboard/lib/dashboard-config/store", () => ({
  invalidateDashboardConfigCache: store.invalidateDashboardConfigCache,
  readDashboardConfig: store.readDashboardConfig,
  writeDashboardConfig: store.writeDashboardConfig,
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET, PUT } from "../../app/api/kody/dashboard-config/route";

beforeEach(() => {
  vi.clearAllMocks();
  auth.verifyActorLogin.mockResolvedValue({ identity: { login: "alice" } });
});

describe("GET /api/kody/dashboard-config", () => {
  it("reads shared config directly from Convex", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/kody/dashboard-config"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      config: { version: 1, namedPreviews: [] },
    });
    expect(backgroundToken.resolveBackgroundToken).not.toHaveBeenCalled();
    expect(githubClient.createUserOctokit).not.toHaveBeenCalled();
    expect(store.readDashboardConfig).toHaveBeenCalledWith("acme", "widgets");
    expect(auth.getUserOctokit).not.toHaveBeenCalled();
  });

  it("does not require a viewer token when no background token is available", async () => {
    backgroundToken.resolveBackgroundToken.mockResolvedValueOnce(null);

    const res = await GET(
      new NextRequest("http://localhost/api/kody/dashboard-config"),
    );

    expect(res.status).toBe(200);
    expect(auth.getUserOctokit).not.toHaveBeenCalled();
    expect(store.readDashboardConfig).toHaveBeenCalledWith("acme", "widgets");
  });

  it("returns Convex-backed view metadata without synthetic GitHub links", async () => {
    store.readDashboardConfig.mockResolvedValueOnce({
      doc: {
        version: 1,
        defaultPreviewUrl: undefined,
        namedPreviews: [
          {
            id: "shop",
            label: "Shop",
            url: "/api/kody/views/shop1-html-050ae2c2/index.html",
            repoViewPath: "views/shop1-html-050ae2c2",
          },
        ],
      },
      sha: "sha-1",
    });

    const res = await GET(
      new NextRequest("http://localhost/api/kody/dashboard-config"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      config: {
        namedPreviews: [
          {
            id: "shop",
            repoViewPath: "views/shop1-html-050ae2c2",
          },
        ],
      },
    });
    expect(stateRepo.resolveStateRepo).not.toHaveBeenCalled();
  });
});

describe("PUT /api/kody/dashboard-config", () => {
  it("preserves an explicit empty preview environment list", async () => {
    store.readDashboardConfig.mockResolvedValueOnce({
      doc: {
        version: 1,
        defaultPreviewUrl: "https://legacy.example.com",
        namedPreviews: [{ id: "prod", label: "Prod", url: "https://prod.dev" }],
      },
      sha: "sha-1",
    });

    const res = await PUT(
      new NextRequest("http://localhost/api/kody/dashboard-config", {
        method: "PUT",
        body: JSON.stringify({
          namedPreviews: [],
          actorLogin: "alice",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(store.writeDashboardConfig).toHaveBeenCalledWith("acme", "widgets", {
      version: 1,
      defaultPreviewUrl: "https://legacy.example.com",
      namedPreviews: [],
    });
  });

  it("writes through the Convex store without requiring a user octokit", async () => {
    auth.getUserOctokit.mockResolvedValueOnce(
      null as unknown as { marker: string },
    );

    const res = await PUT(
      new NextRequest("http://localhost/api/kody/dashboard-config", {
        method: "PUT",
        body: JSON.stringify({
          namedPreviews: [{ id: "prod", label: "Prod", url: "https://p.dev" }],
          actorLogin: "alice",
        }),
      }),
    );

    expect(res.status).toBe(200);
    // Environments persist via the Convex-backed store — no GitHub client
    // is constructed on the write path.
    expect(auth.getUserOctokit).not.toHaveBeenCalled();
    expect(githubClient.createUserOctokit).not.toHaveBeenCalled();
    expect(store.readDashboardConfig).toHaveBeenCalledWith("acme", "widgets", {
      force: true,
    });
    expect(store.writeDashboardConfig).toHaveBeenCalledWith("acme", "widgets", {
      version: 1,
      defaultPreviewUrl: undefined,
      namedPreviews: [{ id: "prod", label: "Prod", url: "https://p.dev" }],
    });
    expect(store.invalidateDashboardConfigCache).toHaveBeenCalledWith(
      "acme",
      "widgets",
    );
  });

  it("accepts a Fly branch preview environment without a URL", async () => {
    const res = await PUT(
      new NextRequest("http://localhost/api/kody/dashboard-config", {
        method: "PUT",
        body: JSON.stringify({
          namedPreviews: [
            {
              id: "dev",
              label: "dev",
              flyBranch: { repo: "acme/widgets", branch: "dev" },
            },
          ],
          actorLogin: "alice",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(store.writeDashboardConfig).toHaveBeenCalledWith("acme", "widgets", {
      version: 1,
      defaultPreviewUrl: undefined,
      namedPreviews: [
        {
          id: "dev",
          label: "dev",
          flyBranch: { repo: "acme/widgets", branch: "dev" },
        },
      ],
    });
  });
});
