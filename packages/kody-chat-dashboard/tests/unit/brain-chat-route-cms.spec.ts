import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireKodyAuth = vi.fn();
const getRequestAuth = vi.fn();
const streamBrainChat = vi.fn();
const loadContextForPrompt = vi.fn();

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: (...args: unknown[]) => requireKodyAuth(...args),
  getRequestAuth: (...args: unknown[]) => getRequestAuth(...args),
}));

vi.mock("@kody-ade/brain/brain-proxy", () => ({
  streamBrainChat: (...args: unknown[]) => streamBrainChat(...args),
}));

vi.mock("@kody-ade/workspace/context/files", () => ({
  loadContextForPrompt: (...args: unknown[]) => loadContextForPrompt(...args),
}));

import { POST } from "../../app/api/kody/chat/brain/route";

function request(body: unknown): NextRequest {
  return new NextRequest("https://dashboard.example.test/api/kody/chat/brain", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-brain-url": "https://brain.example.test",
      "x-brain-key": "brain-key",
      origin: "https://dashboard.example.test",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireKodyAuth.mockResolvedValue(null);
  getRequestAuth.mockReturnValue({
    owner: "acme",
    repo: "widgets",
    token: "ghp_ctx_token",
    storeRepoUrl: "https://github.com/acme/kody-store",
    storeRef: "stable",
  });
  streamBrainChat.mockResolvedValue(new Response("ok", { status: 200 }));
  loadContextForPrompt.mockResolvedValue(null);
});

describe("POST /api/kody/chat/brain CMS context", () => {
  it("forwards the selected Dashboard store target to Brain CMS", async () => {
    const res = await POST(request({ chatId: "c1", message: "show parent" }));

    expect(res.status).toBe(200);
    expect(streamBrainChat).toHaveBeenCalledOnce();
    expect(streamBrainChat.mock.calls.at(-1)![0]).toMatchObject({
      repo: "acme/widgets",
      repoToken: "ghp_ctx_token",
      dashboardUrl: "https://dashboard.example.test",
      storeRepoUrl: "https://github.com/acme/kody-store",
      storeRef: "stable",
    });
  });

  it("forwards the selected personal Brain runtime", async () => {
    await POST(
      request({
        chatId: "c1",
        message: "hello",
        modelId: "codex",
        runtime: "codex app-server",
      }),
    );

    expect(streamBrainChat.mock.calls.at(-1)![0]).toMatchObject({
      modelId: "codex",
      runtime: "codex app-server",
    });
  });

  it("keeps general Brain machine access out of the selected repo", async () => {
    await POST(
      request({
        chatId: "c1",
        message: "inspect this host",
        workspaceMode: "host",
        includeContext: true,
        currentPage: "/repo/acme/widgets/tasks/1",
        taskContext: { id: "repo-task" },
        capabilityContext: { slug: "repo-capability" },
      }),
    );

    const forwarded = streamBrainChat.mock.calls.at(-1)![0];
    expect(forwarded).not.toHaveProperty("repo");
    expect(forwarded).not.toHaveProperty("repoToken");
    expect(forwarded).not.toHaveProperty("storeRepoUrl");
    expect(forwarded).not.toHaveProperty("storeRef");
    expect(forwarded).not.toHaveProperty("taskContext");
    expect(forwarded).not.toHaveProperty("capabilityContext");
    expect(forwarded.message).toBe("inspect this host");
    expect(loadContextForPrompt).not.toHaveBeenCalled();
  });
});
