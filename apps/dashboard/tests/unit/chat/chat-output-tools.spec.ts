import { describe, expect, it } from "vitest";
import {
  FINAL_ANSWER_TOOL,
  SHOW_VIEW_TOOL,
  getToolErrorMessage,
  isToolErrorOutput,
  selectChatOutputActiveTools,
  selectChatOutputToolChoice,
} from "@dashboard/lib/chat-output-tools";

describe("chat output tools", () => {
  it("classifies structured tool error outputs", () => {
    expect(isToolErrorOutput({ error: "show_view requires data" })).toBe(true);
    expect(getToolErrorMessage({ error: "show_view requires data" })).toBe(
      "show_view requires data",
    );
    expect(isToolErrorOutput({ error: "" })).toBe(false);
    expect(isToolErrorOutput({ content: "ok" })).toBe(false);
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

  it("allows read tools before renderer output for explicit selection turns", () => {
    expect(
      selectChatOutputActiveTools({
        toolNames: [FINAL_ANSWER_TOOL, SHOW_VIEW_TOOL, "list_reports"],
        requireViewOutput: true,
        allowPreRenderTools: true,
      }),
    ).toEqual([SHOW_VIEW_TOOL, "list_reports"]);
  });
});
