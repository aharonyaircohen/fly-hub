import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inspection: null as Record<string, unknown> | null,
}));
vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoReadAccess: async () => ({
    auth: { owner: "dashboard-owner", repo: "dashboard-repo" },
    octokit: {},
  }),
}));
vi.mock("../../src/dashboard/lib/apps/source-inspection", () => ({
  inspectRepositoryApp: async (input: Record<string, unknown>) => {
    state.inspection = input;
    return {
      repository: `${input.owner}/${input.repo}`,
      plan: { kind: "node" },
    };
  },
}));

import { POST } from "../../app/api/kody/apps/inspect/route";

describe("App source inspection route", () => {
  beforeEach(() => {
    state.inspection = null;
  });

  it("uses the GitHub repository supplied by the user", async () => {
    const response = await POST(
      new NextRequest("http://test/api/kody/apps/inspect", {
        method: "POST",
        body: JSON.stringify({
          repository: "https://github.com/lfnovo/open-notebook",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(state.inspection).toMatchObject({
      owner: "lfnovo",
      repo: "open-notebook",
    });
  });

  it("falls back to the current repository when no source is supplied", async () => {
    await POST(
      new NextRequest("http://test/api/kody/apps/inspect", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(state.inspection).toMatchObject({
      owner: "dashboard-owner",
      repo: "dashboard-repo",
    });
  });

  it("rejects a non-GitHub URL", async () => {
    const response = await POST(
      new NextRequest("http://test/api/kody/apps/inspect", {
        method: "POST",
        body: JSON.stringify({ repository: "https://example.com/owner/repo" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(state.inspection).toBeNull();
  });
});
