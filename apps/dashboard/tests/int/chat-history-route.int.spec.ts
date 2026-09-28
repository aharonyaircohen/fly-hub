/**
 * @fileoverview Integration coverage for the chat history route
 *   (Convex transcript only).
 * @testFramework vitest
 * @domain chat
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    owner: "acme",
    repo: "widgets",
    token: "ghp_test",
  })),
}));

const convex = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  ...auth,
  verifyRepoReadAccess: auth.requireKodyAuth,
  verifyRepoWriteAccess: auth.requireKodyAuth,
}));
vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  getConvexClient: () => convex,
  backendApi: { conversations: { get: "conversations.get" } },
  tenantIdFor: (owner: string, repo: string) => `${owner}/${repo}`,
}));

import { GET } from "../../app/api/kody/chat/history/route";

function makeReq(query: string): NextRequest {
  return new NextRequest(`https://dash.test/api/kody/chat/history?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireKodyAuth.mockResolvedValue(null);
  auth.getRequestAuth.mockReturnValue({
    owner: "acme",
    repo: "widgets",
    token: "ghp_test",
  });
  convex.query.mockResolvedValue(null);
});

describe("GET /api/kody/chat/history", () => {
  it("returns Convex turns sorted by sequence", async () => {
    convex.query.mockResolvedValue({
      entries: [
        {
          seq: 2,
          entry: {
            kind: "message",
            role: "assistant",
            content: "hi there",
            createdAt: "t2",
          },
        },
        {
          seq: 1,
          entry: {
            kind: "message",
            role: "user",
            content: "hello",
            createdAt: "t1",
          },
        },
      ],
    });

    const res = await GET(makeReq("taskId=task-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      messages: [
        { role: "user", content: "hello", timestamp: "t1" },
        { role: "assistant", content: "hi there", timestamp: "t2" },
      ],
    });
    expect(convex.query).toHaveBeenCalledWith("conversations.get", {
      tenantId: "acme/widgets",
      conversationId: "task-1",
    });
    expect(convex.query).toHaveBeenCalledTimes(1);
  });

  it("requires a taskId", async () => {
    const res = await GET(makeReq(""));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "taskId required" });
    expect(convex.query).not.toHaveBeenCalled();
  });

  it("returns empty messages when Convex has no session", async () => {
    const res = await GET(makeReq("taskId=missing-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ messages: [] });
  });

  it("maps 404 fetch failures to an empty history", async () => {
    convex.query.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );

    const res = await GET(makeReq("taskId=task-404"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ messages: [] });
  });

  it("returns 500 on unexpected fetch failures", async () => {
    convex.query.mockRejectedValue(new Error("convex exploded"));

    const res = await GET(makeReq("taskId=task-1"));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "convex exploded" });
  });
});
