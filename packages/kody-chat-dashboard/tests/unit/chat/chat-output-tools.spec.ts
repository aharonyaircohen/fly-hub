import { describe, expect, it } from "vitest";
import {
  FINAL_ANSWER_TOOL,
  SHOW_VIEW_TOOL,
  shouldRequireFollowUpQuestion,
  getToolErrorMessage,
  getViewRecoveryContent,
  getToollessRecoveryContent,
  normalizeExactOutputContent,
  isToolErrorOutput,
  selectChatOutputActiveTools,
  selectChatOutputToolChoice,
} from "../../../src/dashboard/lib/chat-output-tools";

describe("chat output tools", () => {
  it("keeps ordinary model text when a provider cannot call final_answer", () => {
    expect(getToollessRecoveryContent("Hi there!")).toBe("Hi there!");
    expect(getToollessRecoveryContent("  ")).toContain(
      "I couldn't complete a reliable answer",
    );
  });

  it("classifies structured tool error outputs", () => {
    expect(isToolErrorOutput({ error: "show_view requires data" })).toBe(true);
    expect(getToolErrorMessage({ error: "show_view requires data" })).toBe(
      "show_view requires data",
    );
    expect(isToolErrorOutput({ error: "" })).toBe(false);
    expect(isToolErrorOutput({ content: "ok" })).toBe(false);
  });

  it("falls back to plain text after a broken rendered card", () => {
    expect(getViewRecoveryContent("")).toBe(
      "I couldn't display that UI card. Would you like me to retry?",
    );
    expect(getViewRecoveryContent("I found the agent.")).toBe(
      "I found the agent.\n\nWould you like me to retry?",
    );
  });

  it("keeps renderer tools available for ordinary answer turns", () => {
    expect(
      selectChatOutputActiveTools({
        toolNames: [
          FINAL_ANSWER_TOOL,
          SHOW_VIEW_TOOL,
          "fetch_url",
          "list_reports",
        ],
        requireViewOutput: false,
        allowPreRenderTools: false,
      }),
    ).toEqual([FINAL_ANSWER_TOOL, SHOW_VIEW_TOOL, "fetch_url", "list_reports"]);
  });

  it("pins show_view by name when a step is locked to it (regression: MiniMax ignores generic required and ends with prose)", () => {
    expect(selectChatOutputToolChoice([SHOW_VIEW_TOOL])).toEqual({
      type: "tool",
      toolName: SHOW_VIEW_TOOL,
    });
  });

  it("keeps generic required tool choice when multiple tools are active", () => {
    expect(
      selectChatOutputToolChoice([SHOW_VIEW_TOOL, "list_reports"]),
    ).toEqual("required");
    expect(
      selectChatOutputToolChoice([FINAL_ANSWER_TOOL, SHOW_VIEW_TOOL]),
    ).toEqual("required");
  });

  it("uses automatic selection for providers without strict tool-choice support", () => {
    const capabilities = {
      supportsRequiredToolChoice: false,
      supportsNamedToolChoice: false,
    };

    expect(
      selectChatOutputToolChoice(
        [FINAL_ANSWER_TOOL, SHOW_VIEW_TOOL],
        capabilities,
      ),
    ).toBe("auto");
    expect(selectChatOutputToolChoice([SHOW_VIEW_TOOL], capabilities)).toBe(
      "auto",
    );
  });

  it("allows read tools before renderer output for explicit selection turns", () => {
    expect(
      selectChatOutputActiveTools({
        toolNames: [FINAL_ANSWER_TOOL, SHOW_VIEW_TOOL, "list_reports"],
        requireViewOutput: true,
        allowPreRenderTools: true,
      }),
    ).toEqual([SHOW_VIEW_TOOL, "list_reports"]);
  });

  it.each([
    "Reply with the marker only. No punctuation or other words.",
    "Reply only: remembered.",
    "Return exactly ORBIT-7392 and nothing else.",
  ])(
    "does not require a follow-up for exact-output requests: %s",
    (userText) => {
      expect(shouldRequireFollowUpQuestion(userText)).toBe(false);
    },
  );

  it("keeps the follow-up contract for normal prose requests", () => {
    expect(
      shouldRequireFollowUpQuestion("Explain the Chat architecture."),
    ).toBe(true);
  });

  it.each([
    "Proceed autonomously through implementation and proof.",
    "Keep watching the run and report when the PR opens.",
    "Do not stop or ask me again for approval.",
  ])("does not interrupt autonomous work with a follow-up: %s", (userText) => {
    expect(shouldRequireFollowUpQuestion(userText)).toBe(false);
  });

  it("keeps the follow-up contract when autonomy is only the topic", () => {
    expect(
      shouldRequireFollowUpQuestion("Explain how autonomous runs work."),
    ).toBe(true);
  });

  it.each([
    "What is a repository? Answer in one plain sentence.",
    "Explain the repository in two short sentences. Do not ask a follow-up question.",
    "Give exactly three bullet points about this repository and nothing else.",
    "Where is the repository settings page? Just tell me the path.",
  ])("does not add a follow-up to bounded output requests: %s", (userText) => {
    expect(shouldRequireFollowUpQuestion(userText)).toBe(false);
  });

  it("keeps exact output to the requested token", () => {
    expect(
      normalizeExactOutputContent(
        "details.\n\nLet me save it.\n\nLIVE-9142",
        "Reply with the marker only. No punctuation or other words.",
      ),
    ).toBe("LIVE-9142");
    expect(
      normalizeExactOutputContent("remembered.", "Reply only: remembered."),
    ).toBe("remembered");
  });
});
