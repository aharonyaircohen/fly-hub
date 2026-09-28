/**
 * @testFramework vitest
 * @domain view-renderers
 */
import { describe, expect, it } from "vitest";
import { BUILTIN_VIEW_RENDERER_DEFINITIONS } from "../../../src/dashboard/lib/view-renderers/builtin";
import type { ViewRendererDefinition } from "../../../src/dashboard/lib/view-renderers/standalone-renderer-store";
import {
  shouldAllowPreRenderToolCallsForTurn,
  shouldRequireStructuredViewForTurn,
  shouldRequireViewOutputForTurn,
} from "../../../src/dashboard/lib/view-renderers/chat-intent";

describe("view renderer chat intent", () => {
  const choiceRenderer: ViewRendererDefinition = {
    slug: "choice",
    name: "Choice",
    purpose: "choice",
    rule: "Use when Kody asks the user to choose one item from a list.",
    data: {
      items: { type: "selection", description: "Choices." },
    },
    type: "layout",
    ui: {
      type: "list",
      for: "$items",
      as: "item",
      item: { type: "button", label: "$item.label", action: "$item" },
    },
  };

  const okRenderer: ViewRendererDefinition = {
    slug: "decision",
    name: "Decision",
    purpose: "decision",
    rule: "Use when Kody asks the user to say OK before taking the next step.",
    data: {
      title: { type: "text", description: "Short title." },
    },
    type: "layout",
    ui: { type: "text", value: "$title", variant: "title" },
  };

  const approvalRenderer: ViewRendererDefinition = {
    slug: "decision-card",
    name: "Decision card",
    purpose: "decision",
    rule: "Use this purpose when Kody asks the user to approve, confirm, say OK, edit, cancel, or continue before taking the next step.",
    data: {
      title: {
        type: "text",
        description: "Short decision question or decision title.",
      },
      body: {
        type: "text",
        optional: true,
        description: "The action, plan, or context the user is reviewing.",
      },
      actions: {
        type: "actions",
        optional: true,
        description: "Available responses.",
      },
    },
    type: "layout",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "$title", variant: "title" },
        { type: "text", value: "$body" },
        {
          type: "row",
          for: "$actions",
          as: "action",
          item: { type: "button", label: "$action.label", action: "$action" },
        },
      ],
    },
  };

  const multiChoiceRenderer: ViewRendererDefinition = {
    slug: "bulk-choice",
    name: "Bulk choice",
    purpose: "bulk-choice",
    rule: "Use when Kody asks the user to choose multiple, several, or a few items from a list.",
    data: {
      items: { type: "selection", description: "Choices." },
    },
    type: "layout",
    ui: {
      type: "list",
      for: "$items",
      as: "item",
      item: {
        type: "checkbox",
        name: "selected",
        value: "$item.id",
        label: "$item.label",
      },
    },
  };

  it("requires a rendered view when the user asks to select from listed records", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "list all reports allow me to select one",
        definitions: [choiceRenderer],
      }),
    ).toBe(true);
  });

  it("requires a rendered view when the user asks to select a few records", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "list reports and allow me to select a few",
        definitions: [multiChoiceRenderer],
      }),
    ).toBe(true);
  });

  it("does not require another renderer after a rendered view result", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText:
          'Selected: CTO Report (cto), Kody Health Check (health)\n\n<view_result>{"kind":"view_result","view":"renderer","actionId":"submit","result":{"selected":[{"value":"cto","label":"CTO Report"},{"value":"health","label":"Kody Health Check"}]}}</view_result>',
        definitions: [multiChoiceRenderer],
      }),
    ).toBe(false);
  });

  it("uses renderer definition text for non-list interactions too", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "ask the user a q which requires ok",
        definitions: [okRenderer],
      }),
    ).toBe(true);
  });

  it("requires a rendered view for approval confirmation wording", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "aske me a q and ask for approval to confirm it",
        definitions: [approvalRenderer],
      }),
    ).toBe(true);
  });

  it("does not turn a direct request to ask a specialist into an approval card", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText:
          "Ask the best specialist to explain this repository's structure.",
        definitions: [approvalRenderer],
      }),
    ).toBe(false);
  });

  it("keeps link requests as plain answers even when a resource matches a renderer", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "Provide the link to the CTO agent.",
        definitions: [
          {
            ...approvalRenderer,
            name: "Agent",
            purpose: "agent",
            rule: "Use for Agent records.",
          },
        ],
      }),
    ).toBe(false);
  });

  it("allows plain output when no renderer definitions are available", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "list all reports allow me to select one",
        definitions: [],
      }),
    ).toBe(false);
  });

  it("allows plain output for ordinary report listing requests", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "list all reports",
        definitions: [choiceRenderer],
      }),
    ).toBe(false);
  });

  it("requires a structured view for data presentation requests", () => {
    expect(
      shouldRequireStructuredViewForTurn("list all agency workflows"),
    ).toBe(true);
    expect(
      shouldRequireStructuredViewForTurn("show available workflow runs"),
    ).toBe(true);
    expect(
      shouldRequireStructuredViewForTurn("which workflows are available?"),
    ).toBe(true);
  });

  it("keeps narrative requests as text even when tools provide data", () => {
    expect(shouldRequireStructuredViewForTurn("explain agency workflows")).toBe(
      false,
    );
    expect(
      shouldRequireStructuredViewForTurn("diagnose why the workflow failed"),
    ).toBe(false);
    expect(
      shouldRequireStructuredViewForTurn("advise me on workflow design"),
    ).toBe(false);
  });

  it("does not require a view when the request does not match the renderer", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "summarize all reports",
        definitions: [choiceRenderer],
      }),
    ).toBe(false);
  });

  it("keeps matching explanation requests as plain answers", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "Explain AI Agency structure.",
        definitions: [
          {
            ...approvalRenderer,
            purpose: "agency",
            rule: "Use for Agency requests.",
          },
        ],
      }),
    ).toBe(false);
  });

  it("keeps architecture advice as text even when it mentions adding a rendered resource", () => {
    for (const userText of [
      "Should this project add another chat system?",
      "Can we add another chat system without duplicating ownership?",
    ]) {
      expect(
        shouldRequireViewOutputForTurn({
          userText,
          definitions: BUILTIN_VIEW_RENDERER_DEFINITIONS,
        }),
      ).toBe(false);
    }
  });

  it.each([
    "We are testing Chat only. Do not create or prepare an Issue, change files, run workflows, or use machine access. In one short plain-text reply, state the selected repository and suggest one small Chat feature worth planning later. Take no action.",
    "Reply with the marker only. No punctuation or other words.",
  ])(
    "keeps explicit plain-text replies out of renderer routing: %s",
    (userText) => {
      expect(
        shouldRequireViewOutputForTurn({
          userText,
          definitions: BUILTIN_VIEW_RENDERER_DEFINITIONS,
        }),
      ).toBe(false);
    },
  );

  it("does not force an interactive renderer for report read and publish operations", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText:
          "Read the saved report with slug project-assessment. Rewrite it into one concise decision report and publish a new run under the same slug.",
        definitions: BUILTIN_VIEW_RENDERER_DEFINITIONS,
      }),
    ).toBe(false);
  });

  it("still renders when a report operation explicitly asks the user to choose", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "Read the available reports and let me select one.",
        definitions: [choiceRenderer],
      }),
    ).toBe(true);
  });

  it("uses the built-in form for creation requests that need user values", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "can u create new todo",
        definitions: BUILTIN_VIEW_RENDERER_DEFINITIONS,
      }),
    ).toBe(true);
    expect(
      shouldRequireViewOutputForTurn({
        userText: "Explain how to create a Todo.",
        definitions: BUILTIN_VIEW_RENDERER_DEFINITIONS,
      }),
    ).toBe(false);
  });

  it("allows read tools before rendering when the request names matching records", () => {
    expect(
      shouldAllowPreRenderToolCallsForTurn({
        userText: "list all reports allow me to select one",
        toolNames: ["list_reports", "read_report", "show_view"],
      }),
    ).toBe(true);
  });

  it("does not treat the read VERB alone as a data match (regression: 'random list of items' stalled on unused read tools)", () => {
    // "list" matches the verb prefix of list_reports, but the request
    // names no actual record domain — the turn must lock straight to
    // show_view so tool forcing can be pinned.
    expect(
      shouldAllowPreRenderToolCallsForTurn({
        userText: "show me random list of items and let me select a few",
        toolNames: ["list_reports", "read_report", "show_view"],
      }),
    ).toBe(false);
  });

  it("does not allow unrelated tools before pure approval rendering", () => {
    expect(
      shouldAllowPreRenderToolCallsForTurn({
        userText: "aske me a q and ask for approval to confirm it",
        toolNames: ["list_reports", "read_report", "show_view"],
      }),
    ).toBe(false);
  });
});
