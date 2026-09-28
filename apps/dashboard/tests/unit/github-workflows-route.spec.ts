import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  getRequestAuth: vi.fn(),
  getUserOctokit: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: h.requireKodyAuth,
  getRequestAuth: h.getRequestAuth,
  getUserOctokit: h.getUserOctokit,
}));

import { GET } from "../../app/api/kody/github/workflows/route";

function request() {
  return new NextRequest("https://dash.test/api/kody/github/workflows", {
    headers: {
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
  });
}

describe("GET /api/kody/github/workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.getRequestAuth.mockReturnValue({
      token: "ghp_test-token",
      owner: "acme",
      repo: "widgets",
    });
  });

  it("returns stable workflow choices without exposing the full GitHub response", async () => {
    const listRepoWorkflows = vi.fn().mockResolvedValue({
      data: {
        workflows: [
          {
            id: 12,
            name: "CI",
            path: ".github/workflows/ci.yml",
            state: "active",
          },
        ],
      },
    });
    h.getUserOctokit.mockResolvedValue({ actions: { listRepoWorkflows } });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      workflows: [
        {
          id: 12,
          name: "CI",
          path: ".github/workflows/ci.yml",
          state: "active",
        },
      ],
    });
    expect(listRepoWorkflows).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      per_page: 100,
    });
  });

  it("rejects requests without repository context", async () => {
    h.getRequestAuth.mockReturnValue(null);

    const response = await GET(request());

    expect(response.status).toBe(400);
    expect(h.getUserOctokit).not.toHaveBeenCalled();
  });
});
