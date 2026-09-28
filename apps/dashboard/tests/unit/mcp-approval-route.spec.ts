import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { verifyRepoWriteAccess, decideMcpApprovalRequest, dependencies } =
  vi.hoisted(() => ({
    verifyRepoWriteAccess: vi.fn(),
    decideMcpApprovalRequest: vi.fn(),
    dependencies: {},
  }));

vi.mock("@kody-ade/base/auth", () => ({ verifyRepoWriteAccess }));
vi.mock("@dashboard/lib/mcp/approval-service", () => ({
  createApprovalDecisionDependencies: () => dependencies,
  decideMcpApprovalRequest,
}));

import { POST } from "../../app/api/kody/mcp/approvals/[requestId]/route";

function request(body: unknown) {
  return new NextRequest(
    "https://dash.test/api/kody/mcp/approvals/request-1",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("MCP approval route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyRepoWriteAccess.mockResolvedValue({
      auth: { owner: "acme", repo: "widgets" },
      actorLogin: "octocat",
      actorGithubId: 42,
    });
  });

  it("uses the verified repository and user for an approval decision", async () => {
    decideMcpApprovalRequest.mockResolvedValue({
      requestId: "request-1",
      status: "dispatched",
      runId: "run-1",
    });
    const response = await POST(request({ decision: "approved" }), {
      params: Promise.resolve({ requestId: "request-1" }),
    });
    expect(response.status).toBe(202);
    expect(decideMcpApprovalRequest).toHaveBeenCalledWith(
      {
        tenantId: "acme/widgets",
        requestId: "request-1",
        decision: "approved",
        decidedBy: "github:42",
      },
      dependencies,
    );
  });

  it("rejects invalid input and unavailable decisions safely", async () => {
    expect(
      (
        await POST(request({ decision: "maybe" }), {
          params: Promise.resolve({ requestId: "request-1" }),
        })
      ).status,
    ).toBe(400);
    decideMcpApprovalRequest.mockRejectedValue(
      new Error("Approval request is unavailable"),
    );
    const unavailable = await POST(request({ decision: "rejected" }), {
      params: Promise.resolve({ requestId: "request-1" }),
    });
    expect(unavailable.status).toBe(409);
    expect(JSON.stringify(await unavailable.json())).not.toContain(
      "signed-token",
    );
  });

  it("preserves repository authorization failures", async () => {
    verifyRepoWriteAccess.mockResolvedValue(
      NextResponse.json({ error: "forbidden" }, { status: 403 }),
    );
    expect(
      (
        await POST(request({ decision: "approved" }), {
          params: Promise.resolve({ requestId: "request-1" }),
        })
      ).status,
    ).toBe(403);
    expect(decideMcpApprovalRequest).not.toHaveBeenCalled();
  });
});
