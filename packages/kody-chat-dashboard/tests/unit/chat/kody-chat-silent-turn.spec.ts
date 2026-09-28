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
import { finalizeKodyDirectTurn } from "../../../src/dashboard/lib/components/kody-chat-send";
import {
  MODEL_OPERATION_FAILURE_NOTICE,
  getIncompleteAssistantNotice,
  normalizeModelOperationFailure,
} from "../../../src/dashboard/lib/chat/core/silent-turn";
import type { Message } from "../../../src/dashboard/lib/components/kody-chat-types";

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

  it("does not count completed specialist activity as a user-facing answer", () => {
    const settled = settle({
      role: "assistant",
      content: "<think>User Safety: safe</think>",
      timestamp: new Date().toISOString(),
      isLoading: true,
      toolCalls: [
        {
          name: "delegate_to_public_agent",
          displayName: "Agency Specialist",
          activityKind: "subagent",
          arguments: {},
          status: "success",
        },
      ],
    });

    expect(settled.isLoading).toBe(false);
    expect(settled.isError).toBe(true);
    expect(settled.content).toContain("no response");
  });
});

describe("model operation failure notice", () => {
  it("uses the operation notice after tool activity produced no result", () => {
    expect(
      getIncompleteAssistantNotice({
        hasToolActivity: true,
        hasTransientStatus: false,
      }),
    ).toBe(MODEL_OPERATION_FAILURE_NOTICE);
  });

  it("normalizes unsupported tool protocols without naming a provider", () => {
    expect(
      normalizeModelOperationFailure(
        "[trace a1b2c3d4] No endpoints found that support tool use",
      ),
    ).toBe(`${MODEL_OPERATION_FAILURE_NOTICE} (trace a1b2c3d4)`);
    expect(
      normalizeModelOperationFailure(
        "Tool 'remove_workflow' is not defined for this model",
      ),
    ).toBe(MODEL_OPERATION_FAILURE_NOTICE);
    expect(
      normalizeModelOperationFailure(
        "AI_NoSuchToolError: Model tried to call unavailable tool 'remove_package'",
      ),
    ).toBe(MODEL_OPERATION_FAILURE_NOTICE);
    expect(
      normalizeModelOperationFailure(
        "No endpoints found that support tool use (trace z9y8x7w6)",
      ),
    ).toBe(`${MODEL_OPERATION_FAILURE_NOTICE} (trace z9y8x7w6)`);
  });

  it("preserves unrelated provider errors", () => {
    expect(normalizeModelOperationFailure("model overloaded")).toBe(
      "model overloaded",
    );
  });

  it("turns a missing model key into an actionable setup message", () => {
    expect(normalizeModelOperationFailure("Error: model_api_key_missing")).toBe(
      "This chat model is not configured. Add its API key under Settings → Secrets, or choose another model.",
    );
  });

  it("explains OpenRouter account provider policy failures", () => {
    expect(
      normalizeModelOperationFailure(
        "[trace fc6219ce] Failed after 2 attempts with non-retryable error: 'No allowed providers are available for the selected model. Providers serving openrouter/free: nvidia, liquid, but your account's allowed-providers setting permits only: xai, openai.'",
      ),
    ).toBe(
      "OpenRouter blocked this free model because your account only allows selected providers. Update the allowed providers in OpenRouter Privacy settings, then try again. https://openrouter.ai/settings/privacy (trace fc6219ce)",
    );
  });
});
