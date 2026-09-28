/**
 * @fileoverview Regression: a GuidedFlow step card returned by
 * `guided_flow_start` (resultTarget "guided-flow", carries the
 * instanceId/stepId/revision needed to submit) must survive the model
 * re-rendering the same step via `show_view` later in the turn. The echo
 * is a chat-target directive without guided-flow metadata — if it
 * overwrites the bubble's view, clicking the card posts button text into
 * chat instead of POSTing a submit to /api/kody/guided-flows, and the
 * flow never advances.
 * @testFramework vitest
 * @domain chat-surface
 */

import { describe, it, expect } from "vitest";
import { createTransportTurnHandler } from "../../../src/dashboard/lib/components/kody-chat-transport-events";
import type { Message } from "../../../src/dashboard/lib/components/kody-chat-types";
import type { RenderedViewDirective } from "../../../src/dashboard/lib/chat-ui-actions";
import {
  hasSuccessfulRenderedViewResult,
  hasVisibleChatToolOutput,
} from "../../../src/dashboard/lib/chat-output-tools";

function guidedFlowView(): RenderedViewDirective {
  return {
    action: "render_view",
    view: "renderer",
    id: "guided-flow-inst-1-0",
    rendererSlug: "guided-step",
    rendererName: "Guided step",
    resultTarget: "guided-flow",
    guidedFlow: { instanceId: "inst-1", stepId: "step-1", revision: 0 },
    ui: {
      type: "stack",
      children: [
        { type: "markdown", value: "Step 1 of 3" },
        {
          type: "button",
          label: "Continue",
          action: { id: "continue", label: "Continue", response: "Continue" },
        },
      ],
    },
    data: {},
  };
}

function chatEchoView(): RenderedViewDirective {
  return {
    action: "render_view",
    view: "renderer",
    id: "view-echo",
    rendererSlug: "guided-step",
    rendererName: "Guided step",
    resultTarget: "chat",
    ui: {
      type: "stack",
      children: [
        { type: "markdown", value: "Step 1 of 3" },
        {
          type: "button",
          label: "Continue",
          action: { id: "continue", label: "Continue", response: "Continue" },
        },
      ],
    },
    data: {},
  };
}

function runTurn(directives: RenderedViewDirective[]) {
  let messages: Message[] = [
    {
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      isLoading: true,
      toolCalls: [],
    },
  ];
  const handler = createTransportTurnHandler({
    setMessages: (updater) => {
      messages = updater(messages);
    },
    setLoading: () => {},
    emitVoiceDelta: null,
    voiceMode: false,
  });
  for (const payload of directives) {
    handler.handleEvent({
      type: "directive",
      directive: {
        kind: "rendered-view",
        payload,
        presentation: "replace",
      },
    });
  }
  return { messages, state: handler.state };
}

describe("guided-flow view precedence in a turn", () => {
  it("keeps the guided-flow view when a chat-target echo arrives later", () => {
    const { messages, state } = runTurn([guidedFlowView(), chatEchoView()]);

    expect(state.pendingView?.resultTarget).toBe("guided-flow");
    expect(state.pendingView?.guidedFlow?.instanceId).toBe("inst-1");
    expect(messages[0].view?.resultTarget).toBe("guided-flow");
    expect(messages[0].view?.guidedFlow?.instanceId).toBe("inst-1");
  });

  it("still lets a guided-flow view replace an earlier chat view", () => {
    const { messages, state } = runTurn([chatEchoView(), guidedFlowView()]);

    expect(state.pendingView?.resultTarget).toBe("guided-flow");
    expect(messages[0].view?.resultTarget).toBe("guided-flow");
  });

  it("still lets a later chat view replace an earlier chat view", () => {
    const second = { ...chatEchoView(), id: "view-echo-2" };
    const { state } = runTurn([chatEchoView(), second]);

    expect(state.pendingView?.id).toBe("view-echo-2");
  });
});

describe("kody-direct route ends the turn on a rendered-view tool result", () => {
  it("stops the model turn once any tool returned a view directive, so the model never re-renders it via show_view", () => {
    const steps = [
      {
        toolResults: [
          { toolName: "guided_flow_start", output: guidedFlowView() },
        ],
      },
    ];

    expect(hasSuccessfulRenderedViewResult(steps)).toBe(true);
  });

  it("counts a rendered-view tool result as visible output in the silent-turn retry", () => {
    const steps = [
      {
        toolResults: [
          { toolName: "guided_flow_start", output: guidedFlowView() },
        ],
      },
    ];

    expect(hasVisibleChatToolOutput(steps)).toBe(true);
  });
});
