import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  getRequestAuth: vi.fn(),
  getUserOctokit: vi.fn(),
  readDashboardConfig: vi.fn(),
  resolvePreviewConfigForOctokit: vi.fn(),
  getPreview: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: mocks.requireKodyAuth,
  getRequestAuth: mocks.getRequestAuth,
  getUserOctokit: mocks.getUserOctokit,
}));
vi.mock("@dashboard/lib/dashboard-config/store", () => ({
  readDashboardConfig: mocks.readDashboardConfig,
  setBranchPreview: vi.fn(),
}));
vi.mock("@kody-ade/fly/previews/config", () => ({
  resolvePreviewConfigForOctokit: mocks.resolvePreviewConfigForOctokit,
}));
vi.mock("@kody-ade/fly/previews/preview-lifecycle", () => ({
  createPreview: vi.fn(),
  destroyPreview: vi.fn(),
  getPreview: mocks.getPreview,
}));
vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { GET } from "../../app/api/kody/previews/branch/route";
import { verifyBranchPreviewTicket } from "@kody-ade/fly/preview-token";

describe("GET /api/kody/previews/branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KODY_MASTER_KEY = "test-master-key-aaaaaaaaaaaaaaaaaaaaaaaa";
    mocks.requireKodyAuth.mockResolvedValue(null);
    mocks.getRequestAuth.mockReturnValue({
      owner: "owner",
      repo: "repo",
      token: "github-token",
    });
    mocks.getUserOctokit.mockResolvedValue({ rest: {} });
    mocks.resolvePreviewConfigForOctokit.mockResolvedValue({
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });
    mocks.readDashboardConfig.mockResolvedValue({
      doc: { branchPreviews: ["dev"] },
      sha: "config-sha",
    });
    mocks.getPreview.mockResolvedValue({
      state: "started",
      url: "https://branch.fly.dev",
      appName: "branch-app",
      machineId: "machine-1",
    });
  });

  it("returns branch preview URLs with signed access tickets", async () => {
    const res = await GET(
      new NextRequest("https://dash.test/api/kody/previews/branch"),
    );
    const body = (await res.json()) as {
      previews: Array<{ branch: string; url: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.previews[0].url).toContain("https://branch.fly.dev?kp=");

    const url = new URL(body.previews[0].url);
    const ticket = url.searchParams.get("kp");
    expect(ticket).toBeTruthy();
    expect(verifyBranchPreviewTicket(ticket!, "owner/repo", "dev")).toBe(true);
  });
});
