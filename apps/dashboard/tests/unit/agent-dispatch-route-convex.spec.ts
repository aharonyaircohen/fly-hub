/**
 * Unit tests for the rehosted POST /api/kody/agents/:slug/dispatch route:
 * agent resolution goes through the dashboard's Convex-backed agent-files
 * lib, and the dispatch contract (control-issue directive, 404 on unknown
 * agent, slug/body validation) is unchanged from the agency original.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const agentFiles = vi.hoisted(() => ({
  readResolvedAgentFile: vi.fn(),
}));
vi.mock("@dashboard/lib/agent-files", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@dashboard/lib/agent-files")>();
  return {
    ...actual,
    readResolvedAgentFile: agentFiles.readResolvedAgentFile,
  };
});

const controlIssue = vi.hoisted(() => ({
  findOrCreateControlIssue: vi.fn(async () => 7),
  dispatchAgentAsk: vi.fn(async () => ({
    issueNumber: 7,
    commentId: 99,
    commentUrl: "https://github.com/acme/widgets/issues/7#issuecomment-99",
  })),
}));
vi.mock("@kody-ade/base/control-issue", () => controlIssue);

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    owner: "acme",
    repo: "widgets",
    token: "t",
  })),
  getUserOctokit: vi.fn(async () => ({}) as never),
  verifyActorLogin: vi.fn(async () => null),
}));

vi.mock("@kody-ade/base/activity/audit", () => ({
  recordAudit: vi.fn(),
}));

import { POST } from "../../app/api/kody/agents/[slug]/dispatch/route";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/agents/scout/dispatch", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  controlIssue.findOrCreateControlIssue.mockResolvedValue(7);
  controlIssue.dispatchAgentAsk.mockResolvedValue({
    issueNumber: 7,
    commentId: 99,
    commentUrl: "https://github.com/acme/widgets/issues/7#issuecomment-99",
  });
});

describe("POST /api/kody/agents/:slug/dispatch (dashboard rehost)", () => {
  it("resolves the agent via the dashboard lib and dispatches", async () => {
    agentFiles.readResolvedAgentFile.mockResolvedValue({ slug: "scout" });

    const res = await POST(makeReq({ message: "go" }), params("scout"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, issueNumber: 7 });
    expect(agentFiles.readResolvedAgentFile).toHaveBeenCalledWith(
      "scout",
      expect.anything(),
    );
    expect(controlIssue.dispatchAgentAsk).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "widgets",
      expect.objectContaining({ slug: "scout", message: "go" }),
    );
  });

  it("returns 404 when the agent is unknown", async () => {
    agentFiles.readResolvedAgentFile.mockResolvedValue(null);

    const res = await POST(makeReq({ message: "go" }), params("ghost"));

    expect(res.status).toBe(404);
    expect(controlIssue.dispatchAgentAsk).not.toHaveBeenCalled();
  });

  it("rejects invalid slugs before resolving", async () => {
    const res = await POST(makeReq({ message: "go" }), params("Not Valid!"));

    expect(res.status).toBe(400);
    expect(agentFiles.readResolvedAgentFile).not.toHaveBeenCalled();
  });

  it("rejects empty messages with a validation error", async () => {
    const res = await POST(makeReq({ message: "  " }), params("scout"));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation_error");
  });

  it("appends the actor mention footer when actorLogin is given", async () => {
    agentFiles.readResolvedAgentFile.mockResolvedValue({ slug: "scout" });

    await POST(
      makeReq({ message: "go", actorLogin: "octocat" }),
      params("scout"),
    );

    const dispatched = (
      controlIssue.dispatchAgentAsk.mock.calls[0] as unknown as unknown[]
    )[3] as { message: string };
    expect(dispatched.message).toContain("@octocat");
  });
});
