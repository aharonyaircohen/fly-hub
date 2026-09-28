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
  vi.clearAllMocks();
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
    const res = await POST(request({ chatId: "c1", message: "show course" }));

    expect(res.status).toBe(200);
    expect(streamBrainChat).toHaveBeenCalledOnce();
    expect(streamBrainChat.mock.calls[0]![0]).toMatchObject({
      repo: "acme/widgets",
      repoToken: "ghp_ctx_token",
      dashboardUrl: "https://dashboard.example.test",
      storeRepoUrl: "https://github.com/acme/kody-store",
      storeRef: "stable",
    });
  });

  it("adds the explicitly requested Dashboard feature guide to the Brain turn", async () => {
    const res = await POST(
      request({
        chatId: "c1",
        currentPage: "the Inbox page (/inbox)",
        message: "Can a Workflow schedule itself every night?",
      }),
    );

    expect(res.status).toBe(200);
    expect(streamBrainChat.mock.calls[0]![0]).toMatchObject({
      message: expect.stringContaining(
        "## Dashboard feature guide — Workflows",
      ),
    });
    expect(streamBrainChat.mock.calls[0]![0].message).toContain(
      "A Workflow cannot provide a schedule or recurring trigger",
    );
    expect(streamBrainChat.mock.calls[0]![0].message).toContain(
      "Can a Workflow schedule itself every night?",
    );
  });
});
