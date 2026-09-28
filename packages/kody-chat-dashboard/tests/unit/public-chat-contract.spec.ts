import { describe, expect, it } from "vitest";
import {
  applyChatEvent,
  normalizeChatError,
  type ChatConversation,
  type ChatMessage,
} from "../../../kody-chat/src/core";

const assistantMessage: ChatMessage = {
  id: "assistant-1",
  role: "assistant",
  content: "",
};

describe("public chat event contract", () => {
  it("streams text into the active assistant message", () => {
    const messages = applyChatEvent([assistantMessage], "assistant-1", {
      type: "text-delta",
      text: "Hello",
    });

    expect(messages[0]?.content).toBe("Hello");
  });

  it("replaces streamed text when the transport supplies a final answer", () => {
    const messages = applyChatEvent(
      [{ ...assistantMessage, content: "draft" }],
      "assistant-1",
      { type: "text-replace", text: "final" },
    );

    expect(messages[0]?.content).toBe("final");
  });

  it("turns a transport failure into visible assistant text", () => {
    const messages = applyChatEvent([assistantMessage], "assistant-1", {
      type: "error",
      message: "Connection failed",
    });

    expect(messages[0]).toMatchObject({
      content: "Connection failed",
      status: "error",
    });
  });

  it("ignores newer transport events that this package version does not understand", () => {
    const messages = applyChatEvent([assistantMessage], "assistant-1", {
      type: "future-event",
      payload: { value: true },
    });

    expect(messages).toEqual([assistantMessage]);
  });
});

describe("public host failures", () => {
  it("keeps typed storage failures stable for host and UI recovery", () => {
    const failure = normalizeChatError(
      { kind: "storage", message: "Database unavailable", retryable: true },
      "transport",
    );

    expect(failure).toMatchObject({
      kind: "storage",
      message: "Database unavailable",
      retryable: true,
    });
  });

  it("falls back to a safe message for unknown thrown values", () => {
    expect(normalizeChatError(null, "plugin")).toMatchObject({
      kind: "plugin",
      message: "Chat request failed",
      retryable: false,
    });
  });

  it("defines conversations without product or repository fields", () => {
    const conversation: ChatConversation = {
      id: "conversation-1",
      title: "Support",
      updatedAt: "2026-07-22T12:00:00.000Z",
    };

    expect(conversation).toEqual({
      id: "conversation-1",
      title: "Support",
      updatedAt: "2026-07-22T12:00:00.000Z",
    });
  });
});
