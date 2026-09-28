import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  repository: vi.fn(),
  handle: vi.fn(),
}));
vi.mock("@dashboard/lib/brain/agent-access", () => ({
  requireBrainAgent: mocks.identity,
  requireAgentRepository: mocks.repository,
  agentError: (error: string, status: number) =>
    NextResponse.json({ error }, { status }),
}));
vi.mock("@dashboard/lib/mcp/action-services", () => ({
  createKodyMcpActionServices: () => ({}),
}));
vi.mock("@kody-ade/kody-chat-dashboard/routes/kody/mcp", () => ({
  handleKodyMcpPost: mocks.handle,
}));
import { POST } from "../../app/api/kody/brain/agent/mcp/route";
const request = () =>
  new NextRequest("https://kody.example/api/kody/brain/agent/mcp", {
    method: "POST",
    headers: { "x-kody-agent-repository": "alice/project" },
    body: "{}",
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({
    userId: "owner",
    app: "brain",
    tokenId: "hash",
    createdAt: "2026-09-09T00:00:00.000Z",
  });
  mocks.repository.mockResolvedValue({
    auth: { owner: "alice", repo: "project" },
    actorLogin: "alice",
    actorGithubId: 123,
  });
  mocks.handle.mockImplementation(async (req, options) =>
    NextResponse.json(await options.authenticate(req)),
  );
});
it("reuses the MCP handler with the verified repository principal", async () => {
  const response = await POST(request());
  const principal = await response.json();
  expect(principal).toMatchObject({
    tenantId: "alice/project",
    actorLogin: "alice",
    actorGithubId: 123,
    tokenId: "hash",
  });
  expect(principal.scopes).toContain("mcp:execute");
  expect(mocks.repository).toHaveBeenCalledWith(
    expect.anything(),
    "owner",
    "alice/project",
  );
});
it("never dispatches MCP actions after a rejected repository check", async () => {
  mocks.repository.mockResolvedValue(NextResponse.json({}, { status: 403 }));
  expect((await POST(request())).status).toBe(403);
  expect(mocks.handle).not.toHaveBeenCalled();
});
