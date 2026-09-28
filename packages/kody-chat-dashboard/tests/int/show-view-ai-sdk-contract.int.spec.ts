/**
 * @fileoverview AI SDK contract test for `show_view` spec tool calls: a
 * valid spec streams back a render_view directive; an invalid spec surfaces
 * as a tool ERROR RESULT (not a stream abort), so the model can read the
 * message, fix the spec, and retry within the same turn.
 * @testFramework vitest
 * @domain chat-renderers
 */

import { describe, expect, it } from "vitest";
import { simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { RENDER_VIEW_DIRECTIVE } from "../../src/dashboard/lib/chat-ui-actions";
import { createUiTools } from "../../app/api/kody/chat/tools/ui-tools";
import type { ViewRendererDefinition } from "../../src/dashboard/lib/view-renderers/standalone-renderer-store";

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 1,
    text: 0,
    reasoning: 0,
  },
};

const approvalRendererDefinition: ViewRendererDefinition = {
  slug: "approval-card",
  name: "Approval Card",
  purpose: "approval-card",
  rule: "Use this purpose when Kody asks the user for approval.",
  data: {
    title: { type: "text", description: "Short approval question." },
    body: { type: "text", optional: true },
    actions: { type: "actions", optional: true },
  },
  defaults: {
    actions: [
      {
        id: "approve",
        label: "Approve",
        response: "approve",
        variant: "primary",
      },
      { id: "cancel", label: "Cancel", response: "cancel" },
    ],
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

function toolCallChunk(id: string, input: unknown) {
  return {
    type: "tool-call" as const,
    toolCallId: id,
    toolName: "show_view",
    input: JSON.stringify(input),
  };
}

function finishChunk() {
  return {
    type: "finish" as const,
    finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
    usage,
  };
}

const VALID_SPEC = {
  root: "card",
  elements: {
    card: {
      type: "ApprovalCard",
      props: {
        title: "Confirm this question?",
        body: "Should I continue?",
      },
    },
  },
};

describe("show_view AI SDK contract", () => {
  it("accepts a model-emitted spec and returns a rendered view result", async () => {
    const model = new MockLanguageModelV3({
      modelId: "renderer-contract-model",
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            toolCallChunk("call-approval", VALID_SPEC),
            finishChunk(),
          ],
        }),
      }),
    });
    const tools = createUiTools({
      viewRendererDefinitions: [approvalRendererDefinition],
    });

    const result = streamText({
      model,
      messages: [{ role: "user", content: "ask me a q and ask for approval" }],
      tools: { show_view: tools.show_view },
      toolChoice: { type: "tool", toolName: "show_view" },
      stopWhen: ({ steps }) => steps.length > 0,
    });

    const toolResults = await result.toolResults;
    const showViewTool = model.doStreamCalls[0]?.tools?.find(
      (candidate) => candidate.name === "show_view",
    ) as
      | {
          inputSchema?: {
            required?: string[];
            properties?: {
              elements?: {
                items?: { properties?: { type?: { enum?: string[] } } };
              };
            };
          };
        }
      | undefined;

    expect(showViewTool?.inputSchema?.required).toEqual(["root", "elements"]);
    expect(
      showViewTool?.inputSchema?.properties?.elements?.items?.properties?.type
        ?.enum,
    ).toEqual(expect.arrayContaining(["ApprovalCard", "Stack", "Button"]));
    expect(toolResults).toEqual([
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call-approval",
        toolName: "show_view",
        output: expect.objectContaining({
          action: RENDER_VIEW_DIRECTIVE,
          view: "renderer",
          rendererSlug: "approval-card",
          ui: expect.objectContaining({
            type: "stack",
            children: expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                value: "Confirm this question?",
                variant: "title",
              }),
            ]),
          }),
        }),
      }),
    ]);
  });

  it("returns a model-readable tool error for an invalid spec instead of aborting", async () => {
    const model = new MockLanguageModelV3({
      modelId: "renderer-contract-model",
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            toolCallChunk("call-legacy-shape", {
              purpose: "approval-card",
              data: { title: "Confirm?" },
            }),
            finishChunk(),
          ],
        }),
      }),
    });
    const tools = createUiTools({
      viewRendererDefinitions: [approvalRendererDefinition],
    });

    const result = streamText({
      model,
      messages: [{ role: "user", content: "ask for approval" }],
      tools: { show_view: tools.show_view },
      toolChoice: { type: "tool", toolName: "show_view" },
      stopWhen: ({ steps }) => steps.length > 0,
    });

    const toolResults = await result.toolResults;

    expect(toolResults).toEqual([
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call-legacy-shape",
        toolName: "show_view",
        output: expect.objectContaining({
          error: expect.stringContaining("root"),
        }),
      }),
    ]);
  });

  it("lets the model retry after a validation error within the same turn", async () => {
    let call = 0;
    const model = new MockLanguageModelV3({
      modelId: "renderer-contract-model",
      doStream: async () => {
        call += 1;
        const chunk =
          call === 1
            ? toolCallChunk("call-bad", {
                root: "card",
                elements: {
                  card: {
                    type: "ApprovalCard",
                    props: { heading: "wrong key" },
                  },
                },
              })
            : toolCallChunk("call-fixed", VALID_SPEC);
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              chunk,
              finishChunk(),
            ],
          }),
        };
      },
    });
    const tools = createUiTools({
      viewRendererDefinitions: [approvalRendererDefinition],
    });

    const result = streamText({
      model,
      messages: [{ role: "user", content: "ask for approval" }],
      tools: { show_view: tools.show_view },
      toolChoice: { type: "tool", toolName: "show_view" },
      stopWhen: ({ steps }) => steps.length >= 2,
    });

    const steps = await result.steps;

    expect(steps).toHaveLength(2);
    expect(steps[0].toolResults[0]?.output).toMatchObject({
      error: expect.stringContaining('element "card"'),
    });
    expect(steps[1].toolResults[0]?.output).toMatchObject({
      action: RENDER_VIEW_DIRECTIVE,
      rendererSlug: "approval-card",
    });
  });
});
