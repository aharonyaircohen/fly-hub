/**
 * @fileoverview Integration coverage for the one-shot conversation title route.
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

import { POST } from "../../app/api/kody/chat/title/route";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/title", {
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
  generateTextMock.mockResolvedValue({ text: "Fix login redirect bug" });
});

describe("POST /api/kody/chat/title", () => {
  it("returns a cleaned model-generated title", async () => {
    generateTextMock.mockResolvedValue({
      text: '"Fix login redirect bug." ',
    });

    const res = await POST(
      makeReq({
        messages: [
          { role: "user", content: "my login redirects to the wrong page" },
        ],
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      title: "Fix login redirect bug",
    });
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: "user",
            content: "my login redirects to the wrong page",
          },
        ],
      }),
    );
  });

  it("strips <think> reasoning before titling", async () => {
    const res = await POST(
      makeReq({
        messages: [
          {
            role: "assistant",
            content: "<think>secret scratchpad</think>Deploy the fix",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const call = generateTextMock.mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    expect(call.messages[0].content).not.toContain("secret scratchpad");
  });

  it("rejects malformed JSON bodies", async () => {
    const res = await POST(makeReq("{not json"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON" });
  });

  it("rejects requests with no usable messages", async () => {
    const res = await POST(
      makeReq({ messages: [{ role: "system", content: "hi" }] }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "messages required (non-empty)",
    });
    expect(resolveChatModelMock).not.toHaveBeenCalled();
  });

  it("falls back cleanly when model resolution fails", async () => {
    const { NextResponse } = await import("next/server");
    resolveChatModelMock.mockResolvedValue({
      error: NextResponse.json({ error: "no_model" }, { status: 503 }),
    });

    const res = await POST(
      makeReq({ messages: [{ role: "user", content: "hello" }] }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ title: null });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("falls back cleanly when the model emits reasoning instead of a title", async () => {
    generateTextMock.mockResolvedValue({
      text: "The user just said hi so I should think about what title fits",
    });

    const res = await POST(
      makeReq({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ title: null });
  });

  it("removes model reasoning from a generated title", async () => {
    generateTextMock.mockResolvedValue({
      text: "<think>User said hi.</think> Greeting and introduction",
    });

    const res = await POST(
      makeReq({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      title: "Greeting and introduction",
    });
  });

  it("falls back cleanly when title generation throws", async () => {
    generateTextMock.mockRejectedValue(new Error("provider down"));

    const res = await POST(
      makeReq({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ title: null });
  });
});
