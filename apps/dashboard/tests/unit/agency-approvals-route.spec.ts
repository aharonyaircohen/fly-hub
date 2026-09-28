import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const auth = vi.hoisted(() => ({
  permission: "write",
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({ owner: "acme", repo: "widgets", token: "token" })),
  getUserOctokit: vi.fn(async () => ({
    rest: {
      users: { getAuthenticated: vi.fn(async () => ({ data: { login: "octocat" } })) },
      repos: {
        getCollaboratorPermissionLevel: vi.fn(async () => ({
          data: { permission: auth.permission },
        })),
      },
    },
  })),
  verifyRepoWriteAccess: vi.fn(async () =>
    auth.permission === "write"
      ? {
          auth: { owner: "acme", repo: "widgets", token: "token" },
          actorLogin: "octocat",
        }
      : NextResponse.json(
          { error: "write_permission_required" },
          { status: 403 },
        ),
  ),
}));
vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: auth.requireKodyAuth,
  getRequestAuth: auth.getRequestAuth,
  getUserOctokit: auth.getUserOctokit,
  verifyRepoWriteAccess: auth.verifyRepoWriteAccess,
}));

const store = vi.hoisted(() => ({
  listStoredAgencyApprovals: vi.fn(async () => []),
  grantStoredAgencyApproval: vi.fn(async () => undefined),
  revokeStoredAgencyApproval: vi.fn(async () => undefined),
}));
vi.mock("@kody-ade/agency/backend/agency-approvals-store", () => store);
vi.mock("@kody-ade/agency/src/backend/agency-approvals-store", () => store);

import { DELETE, GET, POST } from "../../app/api/kody/agency-approvals/route";

function request(method: string, body?: unknown, query = "") {
  return new NextRequest(`https://dash.test/api/kody/agency-approvals${query}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.permission = "write";
  store.listStoredAgencyApprovals.mockResolvedValue([]);
});

describe("agency approval route", () => {
  it("grants a one-time approval as the verified GitHub actor", async () => {
    const response = await POST(
      request("POST", {
        scopeKind: "loop",
        scopeId: "daily-maintenance",
        action: "workflow:maintain-system",
      }),
    );

    expect(response.status).toBe(201);
    expect(store.grantStoredAgencyApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        approvedBy: "octocat",
        scopeKind: "loop",
      }),
    );
  });

  it("rejects a user without repository write permission", async () => {
    auth.permission = "read";
    const response = await POST(
      request("POST", { scopeKind: "loop", scopeId: "loop-1", action: "workflow:wf-1" }),
    );

    expect(response.status).toBe(403);
    expect(store.grantStoredAgencyApproval).not.toHaveBeenCalled();
  });

  it("validates list scope pairs", async () => {
    const response = await GET(request("GET", undefined, "?scopeKind=loop"));
    expect(response.status).toBe(400);
    expect(store.listStoredAgencyApprovals).not.toHaveBeenCalled();
  });

  it("revokes an available approval", async () => {
    const response = await DELETE(request("DELETE", { approvalId: "approval-1" }));
    expect(response.status).toBe(200);
    expect(store.revokeStoredAgencyApproval).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      approvalId: "approval-1",
    });
  });
});
