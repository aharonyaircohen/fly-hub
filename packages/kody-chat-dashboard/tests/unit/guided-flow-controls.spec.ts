import { describe, expect, it } from "vitest";

import {
  advanceGuidedFlow,
  createGuidedFlowInstance,
  type GuidedFlowDefinition,
} from "../../src/dashboard/lib/guided-flows/controller";
import {
  executeGuidedFlowControl,
  GuidedFlowControlError,
} from "../../src/dashboard/lib/guided-flows/controls";
import { buildGuidedFlowView } from "../../src/dashboard/lib/guided-flows/registry";
import type {
  RenderedViewAction,
  RenderedViewUiNode,
} from "../../src/dashboard/lib/chat-ui-actions";

function definition(controls?: readonly ["back"]): GuidedFlowDefinition {
  return {
    id: "record",
    version: 1,
    title: "Record",
    ...(controls ? { controls } : {}),
    steps: [
      {
        id: "intro",
        title: "Introduction",
        explanation: "Start here.",
        rendererSlug: "approval-card",
        rendererData: {
          title: "Introduction",
          actions: [
            { id: "continue", label: "Continue", response: "continue" },
          ],
        },
        actions: [
          { id: "continue", target: { type: "step", stepId: "finish" } },
        ],
      },
      {
        id: "finish",
        title: "Finish",
        explanation: "Finish here.",
        rendererSlug: "approval-card",
        rendererData: {
          title: "Finish",
          actions: [
            { id: "complete", label: "Complete", response: "complete" },
          ],
        },
        actions: [{ id: "complete", target: { type: "complete" } }],
      },
    ],
  };
}

function buttonActions(node: RenderedViewUiNode): RenderedViewAction[] {
  if (node.type === "button") return [node.action];
  if (node.type === "stack" || node.type === "row" || node.type === "list") {
    return node.children.flatMap(buttonActions);
  }
  return [];
}

describe("GuidedFlow controls", () => {
  it("does not add Back when the flow did not enable it", () => {
    const flow = definition();
    const instance = advanceGuidedFlow(
      flow,
      createGuidedFlowInstance(flow, "instance-1"),
      { actionId: "continue" },
    );

    expect(buttonActions(buildGuidedFlowView(flow, instance).ui)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dispatch: { type: "control", id: "back" } }),
      ]),
    );
  });

  it("presents Back as a generic renderer control when enabled and available", () => {
    const flow = definition(["back"]);
    const instance = advanceGuidedFlow(
      flow,
      createGuidedFlowInstance(flow, "instance-1"),
      { actionId: "continue" },
    );

    expect(buttonActions(buildGuidedFlowView(flow, instance).ui)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Back",
          dispatch: { type: "control", id: "back" },
        }),
      ]),
    );
  });

  it("executes the registered Back control through the domain function", () => {
    const flow = definition(["back"]);
    const instance = advanceGuidedFlow(
      flow,
      createGuidedFlowInstance(flow, "instance-1"),
      { actionId: "continue" },
    );

    expect(
      executeGuidedFlowControl({
        definition: flow,
        instance,
        controlId: "back",
      }),
    ).toMatchObject({ currentStepId: "intro", revision: 2, backStack: [] });
  });

  it("rejects a control that the flow did not enable", () => {
    const flow = definition();
    const instance = advanceGuidedFlow(
      flow,
      createGuidedFlowInstance(flow, "instance-1"),
      { actionId: "continue" },
    );

    expect(() =>
      executeGuidedFlowControl({
        definition: flow,
        instance,
        controlId: "back",
      }),
    ).toThrow(GuidedFlowControlError);
  });

  it("rejects an enabled control when it is not available", () => {
    const flow = definition(["back"]);

    expect(() =>
      executeGuidedFlowControl({
        definition: flow,
        instance: createGuidedFlowInstance(flow, "instance-1"),
        controlId: "back",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "guided_flow_control_unavailable" }),
    );
  });
});
