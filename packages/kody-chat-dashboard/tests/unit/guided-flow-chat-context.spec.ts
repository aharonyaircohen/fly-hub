import { describe, expect, it } from "vitest";

import { buildGuidedFlowTurnContext } from "../../app/api/kody/chat/guided-flow-context";
import {
  guidedFlowChatReducer,
  initialGuidedFlowChatState,
} from "../../src/dashboard/lib/guided-flows/chat-controller";
import type { GuidedFlowReader } from "../../src/dashboard/lib/guided-flows/reader";

function reader(
  current: Awaited<ReturnType<GuidedFlowReader["getCurrent"]>>,
): GuidedFlowReader {
  return {
    getCurrent: async () => current,
    getOutline: async () => [],
    getStep: async () => null,
    getData: async () => ({}),
    getHistory: async () => ({ items: [] }),
    getModelGuides: async () => [
      "Request Blueprint: Task\nPurpose: Help the user answer correctly.\n1. question [view: selection-list]\n   guidance: Choose one.",
    ],
  };
}

describe("GuidedFlow Chat turn context", () => {
  it("adds only the current pointer and tells Chat to read details", async () => {
    const context = await buildGuidedFlowTurnContext(
      reader({
        binding: {
          conversationId: "conversation-1",
          instanceId: "instance-1",
        },
        instance: {
          instanceId: "instance-1",
          flowId: "task",
          flowVersion: 2,
          currentStepId: "question",
          status: "active",
          revision: 4,
          data: { privateLargeValue: "not-injected" },
          output: {},
          backStack: ["intro"],
          stack: [
            {
              flowId: "record",
              flowVersion: 1,
              currentStepId: "task",
              data: {},
              backStack: ["welcome"],
            },
          ],
        },
        definition: {
          id: "task",
          version: 2,
          title: "Task",
          steps: [
            {
              id: "question",
              title: "Question",
              explanation: "Choose one.",
              rendererSlug: "selection-list",
              actions: [{ id: "submit", target: { type: "complete" } }],
            },
          ],
        },
        currentStep: {
          id: "question",
          title: "Question",
          explanation: "Choose one.",
          rendererSlug: "selection-list",
          actions: [{ id: "submit", target: { type: "complete" } }],
        },
        path: [
          {
            flowId: "record",
            flowVersion: 1,
            currentStepId: "task",
            data: {},
            backStack: ["welcome"],
          },
        ],
      }),
    );

    expect(context).toContain("instance-1");
    expect(context).toContain("task@2 / question");
    expect(context).toContain("record@1 / task");
    expect(context).toContain("guided_flow_read");
    expect(context).toContain("Purpose: Help the user answer correctly.");
    expect(context).toContain("guidance: Choose one.");
    expect(context).not.toContain("privateLargeValue");
  });

  it("adds nothing when the conversation has no bound flow", async () => {
    await expect(buildGuidedFlowTurnContext(reader(null))).resolves.toBeNull();
  });
});

describe("GuidedFlow explicit launch contract", () => {
  it("carries the exact instance to Chat instead of asking Chat to find one", () => {
    const next = guidedFlowChatReducer(initialGuidedFlowChatState, {
      type: "request",
      requestId: "request-1",
      request: { instanceId: "instance-1", message: "started" },
    });

    expect(next.pending?.request).toEqual({
      instanceId: "instance-1",
      message: "started",
    });
  });
});
