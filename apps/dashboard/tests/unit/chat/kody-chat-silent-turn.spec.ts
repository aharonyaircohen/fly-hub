/**
 * Regression: a kody-direct turn that streams ONLY reasoning (no answer
 * text, no successful tool, no view) must not settle as a silent thought
 * bubble — the user reported "ask for approval …" ending with just a
 * collapsed Thought panel and nothing else.
 *
 * @testFramework vitest
 * @domain kody-chat
 */
import { describe, expect, it } from "vitest";
import { finalizeKodyDirectTurn } from "@kody-ade/kody-chat-dashboard/components/kody-chat-send";
import type { Message } from "@kody-ade/kody-chat-dashboard/components/kody-chat-types";

function turnState(overrides: Record<string, unknown> = {}) {
  return {
    reasoningBuf: "",
    textBuf: "",
    latestAssistantText: "",
    exhausted: false,
    lastToolErrorText: null,
    lastToolErrorToolName: null,
    pendingSwitchAgent: null,
    pendingDashboardNavigate: null,
    pendingPreviewAct: null,
    pendingView: null,
    pendingCreatedIssue: null,
    ...overrides,
  } as Parameters<typeof finalizeKodyDirectTurn>[0]["turn"];
}

function settle(message: Message, turn = turnState()) {
  let messages: Message[] = [message];
  finalizeKodyDirectTurn({
    io: {
      setMessages: (updater) => {
        messages = updater(messages);
      },
      setLoading: () => {},
    },
    turn,
    assistantDisplayOverride: null,
  });
  return messages[0];
}

describe("kody-direct silent-turn settle", () => {
  it("surfaces a no-response note when the turn produced only reasoning", () => {
    const settled = settle({
      role: "assistant",
      content: "<think>I should ask for approval via show_view…</think>",
      timestamp: new Date().toISOString(),
      isLoading: true,
      toolCalls: [],
    });

    expect(settled.isLoading).toBe(false);
    expect(settled.isError).toBe(true);
    expect(settled.content).toContain("no response");
  });

  it("keeps a normal turn untouched when reasoning is followed by an answer", () => {
    const settled = settle({
      role: "assistant",
      content: "<think>thinking</think>Here is the answer.",
      timestamp: new Date().toISOString(),
      isLoading: true,
      toolCalls: [],
    });

    expect(settled.isLoading).toBe(false);
    expect(settled.isError).toBeFalsy();
    expect(settled.content).toContain("Here is the answer.");
  });
});
