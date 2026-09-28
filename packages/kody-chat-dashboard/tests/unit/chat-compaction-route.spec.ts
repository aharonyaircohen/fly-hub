import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  resolveChatModel: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: h.requireKodyAuth,
}));
vi.mock("../../app/api/kody/chat/resolve-model", () => ({
  resolveChatModel: h.resolveChatModel,
}));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: h.generateText };
});

import { POST } from "../../app/api/kody/chat/compact/route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/kody/chat/compact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/kody/chat/compact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.resolveChatModel.mockResolvedValue({
      model: { specificationVersion: "v3" },
      resolvedModel: { id: "test-model" },
    });
    h.generateText.mockResolvedValue({
      text: "Goal: retain the conversation.",
    });
  });

  it("requires the normal Kody authentication", async () => {
    h.requireKodyAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const response = await POST(request({ messages: [] }));

    expect(response.status).toBe(401);
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it("rejects oversized conversation input", async () => {
    const response = await POST(
      request({ messages: [{ role: "user", content: "x".repeat(400_001) }] }),
    );

    expect(response.status).toBe(413);
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it("returns a compact summary using the selected chat model", async () => {
    const response = await POST(
      request({
        previousSummary: "Earlier context",
        messages: [
          { role: "user", content: "Implement compaction" },
          { role: "assistant", content: "I will inspect the chat flow" },
        ],
        model: "test-model",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      summary: "Goal: retain the conversation.",
    });
    expect(h.resolveChatModel).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "test-model",
    );
    expect(h.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 1200, temperature: 0.1 }),
    );
  });

  it("does not expose provider errors to the client", async () => {
    h.generateText.mockRejectedValue(new Error("secret provider detail"));

    const response = await POST(
      request({ messages: [{ role: "user", content: "hello" }] }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "compaction_failed",
      message: "Could not compact this conversation.",
    });
  });
});
