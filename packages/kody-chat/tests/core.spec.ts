import { describe, expect, it } from "vitest";

import { applyChatEvent, normalizeChatError } from "../src/core";

describe("public chat core", () => {
  it("normalizes unknown failures without claiming they can be retried", () => {
    expect(normalizeChatError("offline", "transport")).toEqual({
      kind: "transport",
      message: "Chat request failed",
      retryable: false,
      cause: "offline",
    });
  });

  it("applies streamed text only to the active assistant message", () => {
    const messages = [
      { id: "user", role: "user" as const, content: "Hello" },
      { id: "assistant", role: "assistant" as const, content: "Hi" },
    ];

    expect(
      applyChatEvent(messages, "assistant", {
        type: "text-delta",
        text: " there",
      }),
    ).toEqual([
      messages[0],
      { ...messages[1], content: "Hi there" },
    ]);
  });

  it("marks the active assistant message when a stream fails", () => {
    expect(
      applyChatEvent(
        [{ id: "assistant", role: "assistant", content: "" }],
        "assistant",
        { type: "error", message: "Request failed" },
      ),
    ).toEqual([
      {
        id: "assistant",
        role: "assistant",
        content: "Request failed",
        status: "error",
      },
    ]);
  });
});
