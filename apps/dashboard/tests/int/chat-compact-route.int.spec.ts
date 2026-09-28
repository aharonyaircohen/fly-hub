/**
 * @fileoverview Integration coverage for the conversation compaction route.
 * @testFramework vitest
 * @domain chat
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyUser: vi.fn(async () => ({ id: "user-1", label: "Alice" })),
}));

const generateTextMock = vi.hoisted(() => vi.fn());
const resolveChatModelMock = vi.hoisted(() => vi.fn());

vi.mock("@dashboard/lib/auth/kody-user", () => auth);
vi.mock("ai", () => ({
  generateText: generateTextMock,
}));
vi.mock("../../app/api/kody/chat/resolve-model", () => ({
  resolveChatModel: resolveChatModelMock,
}));

import { POST } from "../../app/api/kody/chat/compact/route";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/compact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireKodyUser.mockResolvedValue({ id: "user-1", label: "Alice" });
  resolveChatModelMock.mockResolvedValue({
    model: { modelId: "mock-model" },
    resolvedModel: { id: "mock-model" },
    apiKey: "sk-test",
  });
  generateTextMock.mockResolvedValue({
    text: "Goal: ship the widget. Done: API. Open: tests.",
  });
});

describe("POST /api/kody/chat/compact", () => {
  it("compacts the conversation into a summary", async () => {
    const res = await POST(
      makeReq({
        previousSummary: "Earlier: user set up the repo.",
        messages: [
          { role: "user", content: "now add tests" },
          { role: "assistant", content: "<think>plan</think>Added tests" },
        ],
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      summary: "Goal: ship the widget. Done: API. Open: tests.",
    });

    const call = generateTextMock.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.messages[0]).toEqual({
      role: "user",
      content: "Existing compact memory:\nEarlier: user set up the repo.",
    });
    expect(call.messages[2].content).not.toContain("plan");
  });

  it("rejects malformed JSON bodies", async () => {
    const res = await POST(makeReq("{not json"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON" });
  });

  it("rejects invalid request shapes", async () => {
    const res = await POST(makeReq({ messages: [] }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid request" });
    expect(resolveChatModelMock).not.toHaveBeenCalled();
  });

  it("rejects oversized conversations with 413", async () => {
    const res = await POST(
      makeReq({
        messages: [
          { role: "user", content: "x".repeat(250_000) },
          { role: "assistant", content: "y".repeat(250_000) },
        ],
      }),
    );

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({
      error: "conversation_too_large",
    });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns 400 when every message is pure reasoning", async () => {
    const res = await POST(
      makeReq({
        messages: [{ role: "assistant", content: "<think>only thoughts</think>" }],
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "messages required (non-empty)",
    });
  });

  it("propagates model-resolution errors", async () => {
    const { NextResponse } = await import("next/server");
    resolveChatModelMock.mockResolvedValue({
      error: NextResponse.json({ error: "no_model" }, { status: 503 }),
    });

    const res = await POST(
      makeReq({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(503);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the model produces an empty summary", async () => {
    generateTextMock.mockResolvedValue({ text: "<think>nothing</think>" });

    const res = await POST(
      makeReq({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "compaction_failed" });
  });

  it("returns 502 when compaction throws", async () => {
    generateTextMock.mockRejectedValue(new Error("provider down"));

    const res = await POST(
      makeReq({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "compaction_failed" });
  });
});
