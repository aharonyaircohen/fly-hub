/**
 * Deterministic chat evals for Kody behavior.
 *
 * These do not call a model. They pin the rules that made recent bad
 * conversations fail: fake issue links, noisy clarifying questions, and
 * over-complicated prompt guidance.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { buildSystemPrompt } from "../../../app/api/kody/chat/kody/system-prompt";
import {
  loadChatDefaults,
  composeBasePrompt,
} from "@dashboard/lib/chat-defaults";
import { getCreatedIssueNumberFromToolOutput } from "@kody-ade/kody-chat-dashboard/components/kody-chat-types";

const prompt = buildSystemPrompt(
  composeBasePrompt(await loadChatDefaults("acme", "repo")),
  { owner: "acme", repo: "repo" },
  undefined,
  { vibeMode: true, flyConfigured: false },
);

describe("Kody chat evals", () => {
  it("does not count read-tool issue URLs as newly created issues", () => {
    const existingIssue = {
      number: 77,
      url: "https://github.com/acme/repo/issues/77",
    };

    expect(
      getCreatedIssueNumberFromToolOutput("github_get_issue", existingIssue),
    ).toBeNull();
  });

  it("does not count failed create tools as created issues", () => {
    expect(
      getCreatedIssueNumberFromToolOutput("create_feature", {
        error: "Validation Failed",
      }),
    ).toBeNull();
  });

  it("allows create_task to transfer chat scope after real creation", () => {
    expect(
      getCreatedIssueNumberFromToolOutput("create_task", {
        number: 88,
        url: "https://github.com/acme/repo/issues/88",
      }),
    ).toBe(88);
  });

  it("tells Kody to ask at most one blocking clarifying question", () => {
    expect(prompt).toContain("Ask at most one clarifying question");
    expect(prompt).toContain(
      "If there is no blocking question, ask only for approval",
    );
  });

  it("does not encourage endless clarification loops in Vibe mode", () => {
    expect(prompt).not.toContain("Ask in small batches");
    expect(prompt).not.toContain("repeat. Stop ONLY");
  });

  it("keeps rendered view data scoped to explicit values or the active workflow step", async () => {
    const promptWithPreview = buildSystemPrompt(
      composeBasePrompt(await loadChatDefaults("acme", "repo")),
      { owner: "acme", repo: "repo" },
      undefined,
      {
        previewContext: "Preview shows a Hebrew marketing page.",
        viewRendererRules:
          "- DecisionCard: Use this purpose when Kody presents a decision.",
      },
    );

    expect(promptWithPreview).toContain("Generic view rendering");
    expect(promptWithPreview).toContain(
      "Every final response must use an output tool",
    );
    expect(promptWithPreview).toContain("`final_answer` for plain text");
    expect(promptWithPreview).toContain(
      "If the user asks to show, render, or display a UI/card, that is also a render request",
    );
    expect(promptWithPreview).toContain(
      "Do not print JSON or describe the tool call",
    );
    expect(promptWithPreview).toContain(
      "takes a JSON spec (`root` + flat `elements` map)",
    );
    expect(promptWithPreview).toContain(
      "UI-card requests are display requests, not issue-creation requests",
    );
    expect(promptWithPreview).toContain(
      "Render the requested UI; do not convert it into another workflow",
    );
    expect(promptWithPreview).toContain(
      "Use `show_view` naturally whenever your reply is presenting an interaction",
    );
    expect(promptWithPreview).toContain("The user does not need to ask for UI");
    expect(promptWithPreview).toContain(
      "Prefer a high-level view component when its purpose matches the interaction",
    );
    expect(promptWithPreview).toContain(
      "first call the read/list tool needed to get the records, then call `show_view` with those records as a clear list",
    );
    expect(promptWithPreview).toContain(
      "When the user asks to present structured records, statuses, choices, forms, or other data-shaped results, use `show_view` first",
    );
    expect(promptWithPreview).toContain(
      "Keep explanations, analysis, diagnoses, and advice in `final_answer`",
    );
    expect(promptWithPreview).toContain(
      "Every value you place in the spec must come from one of two places",
    );
    expect(promptWithPreview).toContain(
      "Do not silently copy preview, page, repo, task, memory, or research context into view fields",
    );
    expect(promptWithPreview).toContain(
      "fix the spec exactly as the error describes and call it again",
    );
    expect(promptWithPreview).toContain(
      "Available view components and when to use them:",
    );
    expect(promptWithPreview).toContain(
      "DecisionCard: Use this purpose when Kody presents a decision.",
    );
  });

  it("requires a terminal output tool instead of allowing plain prose stops", () => {
    const route = readFileSync(
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/kody/route.ts",
      "utf8",
    );

    expect(route).toContain("selectChatOutputToolChoice");
    expect(route).toContain("supportsRequiredToolChoice");
    expect(route).toContain("CHAT_OUTPUT_TOOL_NAMES");
    expect(route).toContain("shouldRequireViewOutputForTurn");
    expect(route).toContain("shouldAllowPreRenderToolCallsForTurn");
    expect(route).toContain("definitions: viewRendererDefinitions");
    expect(route).toContain("selectChatOutputActiveTools");
    expect(route).toContain("allActiveTools");
    expect(route).toContain("shouldRequireStructuredViewForTurn");
    expect(route).toContain("requireViewOutputForTurn");
    expect(route).toContain("Do not finish with `final_answer`");
    expect(route).toContain(
      "settledToolAttempts(SHOW_VIEW_TOOL, MAX_SHOW_VIEW_ATTEMPTS)",
    );
    expect(route).toContain("successfulToolResult(FINAL_ANSWER_TOOL)");
  });

  it("retries a failed show_view a bounded number of times, not forever", () => {
    const route = readFileSync(
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/kody/route.ts",
      "utf8",
    );

    expect(route).toContain("MAX_SHOW_VIEW_ATTEMPTS = 3");
    expect(route).toContain(
      "settledToolAttempts(SHOW_VIEW_TOOL, MAX_SHOW_VIEW_ATTEMPTS)",
    );
    expect(route).toContain("successfulToolResult(FINAL_ANSWER_TOOL)");
    // The old behavior ended the turn on the FIRST show_view attempt even
    // when validation failed — that's what forced the repair heuristics.
    expect(route).not.toContain("terminalToolAttempt");
  });
});
