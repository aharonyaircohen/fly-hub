import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const engineStatus = vi.hoisted(() => ({
  getEngineSetupStatus: vi.fn(),
}));

vi.mock("@dashboard/lib/engine/status", () => engineStatus);
vi.mock("@dashboard/lib/github-client", () => ({
  createUserOctokit: vi.fn(() => ({ kind: "octokit" })),
}));

async function loadRoute() {
  vi.resetModules();
  return import("@/../app/api/kody/engine/status/route");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("engine status route", () => {
  it("requires repository authentication", async () => {
    const { GET } = await loadRoute();
    const response = await GET(
      new NextRequest("https://dashboard.test/api/kody/engine/status"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "missing_auth" });
    expect(engineStatus.getEngineSetupStatus).not.toHaveBeenCalled();
  });

  it("checks the repository selected by the request headers", async () => {
    engineStatus.getEngineSetupStatus.mockResolvedValueOnce({
      status: "setup_required",
      files: { workflow: "missing", config: "present" },
    });
    const { GET } = await loadRoute();
    const response = await GET(
      new NextRequest("https://dashboard.test/api/kody/engine/status", {
        headers: {
          "x-kody-token": "github_pat_test",
          "x-kody-owner": "acme",
          "x-kody-repo": "widgets",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "setup_required",
      files: { workflow: "missing", config: "present" },
    });
    expect(engineStatus.getEngineSetupStatus).toHaveBeenCalledWith({
      octokit: { kind: "octokit" },
      owner: "acme",
      repo: "widgets",
    });
  });
});
