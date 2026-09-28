import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  getRequestAuth: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoReadAccess: mocks.requireKodyAuth,
  verifyRepoWriteAccess: mocks.requireKodyAuth,
  requireKodyAuth: mocks.requireKodyAuth,
  getRequestAuth: mocks.getRequestAuth,
}));

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ query: mocks.query }),
}));

import { GET } from "../../app/api/kody/workflow-events/route";

function request(url = "https://dash.test/api/kody/workflow-events?limit=4") {
  return new NextRequest(url, {
    headers: {
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
  });
}

describe("GET /api/kody/workflow-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireKodyAuth.mockResolvedValue(null);
    mocks.getRequestAuth.mockReturnValue({
      token: "ghp_test-token",
      owner: "acme",
      repo: "widgets",
    });
    mocks.query.mockResolvedValue([]);
  });

  it("scopes the read to the authenticated repository", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ events: [], total: 0 }),
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: "acme/widgets", limit: 4 }),
    );
  });

  it("rejects requests without repository identity", async () => {
    mocks.getRequestAuth.mockReturnValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
