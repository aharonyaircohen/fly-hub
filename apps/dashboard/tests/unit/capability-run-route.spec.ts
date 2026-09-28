import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  getUserOctokit: vi.fn(),
  getRequestAuth: vi.fn(),
  readResolvedCapabilityFile: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  recordAudit: vi.fn(),
  buildKodyWorkflowDispatchInputs: vi.fn(),
  getRepo: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: h.requireKodyAuth,
  getUserOctokit: h.getUserOctokit,
  getRequestAuth: h.getRequestAuth,
}));
vi.mock("@dashboard/lib/capabilities", () => ({
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
  readResolvedCapabilityFile: h.readResolvedCapabilityFile,
}));
vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
}));
vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));
vi.mock("@dashboard/lib/kody-workflow-dispatch", () => ({
  buildKodyWorkflowDispatchInputs: h.buildKodyWorkflowDispatchInputs,
}));

import { POST } from "../../app/api/kody/capabilities/[slug]/run/route";

describe("POST /api/kody/capabilities/[slug]/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.getRequestAuth.mockReturnValue({
      owner: "acme",
      repo: "app",
      token: "token",
      storeRepoUrl: "https://github.com/acme/store",
      storeRef: "main",
    });
    h.getRepo.mockResolvedValue({ data: { default_branch: "main" } });
    h.dispatch.mockResolvedValue(undefined);
    h.getUserOctokit.mockResolvedValue({
      rest: {
        repos: { get: h.getRepo },
        actions: { createWorkflowDispatch: h.dispatch },
      },
    });
    h.readResolvedCapabilityFile.mockResolvedValue({
      slug: "store-release",
      source: "store",
    });
    h.buildKodyWorkflowDispatchInputs.mockResolvedValue({
      capability: "store-release",
    });
  });

  it("runs an active Store capability resolved by the Dashboard API", async () => {
    const req = new NextRequest(
      "https://dash.test/api/kody/capabilities/store-release/run",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kody-owner": "acme",
          "x-kody-repo": "app",
          "x-kody-token": "token",
        },
        body: JSON.stringify({ force: true }),
      },
    );
    const response = await POST(req, {
      params: Promise.resolve({ slug: "store-release" }),
    });

    expect(response.status).toBe(200);
    expect(h.readResolvedCapabilityFile).toHaveBeenCalledWith(
      "store-release",
      expect.objectContaining({ rest: expect.any(Object) }),
    );
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "app",
        workflow_id: "kody.yml",
      }),
    );
  });
});
