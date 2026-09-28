import { describe, expect, it } from "vitest";

import {
  createGuidedFlowInstance,
  type GuidedFlowDefinition,
} from "../../src/dashboard/lib/guided-flows/controller";
import { evaluateGuidedFlowCompatibility } from "../../src/dashboard/lib/guided-flows/compatibility";
import type { ViewRendererDefinition } from "../../src/dashboard/lib/view-renderers/definition";

const QUESTION_RENDERER: ViewRendererDefinition = {
  slug: "question-select",
  version: 2,
  name: "Question select",
  purpose: "question-select",
  data: {
    question: {
      type: "json",
      valueSchema: {
        kind: "object",
        required: ["taskId", "questionId"],
        properties: {
          taskId: { kind: "string" },
          questionId: { kind: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  type: "layout",
  ui: {
    type: "widget",
    widget: "question-select",
    version: 6,
    data: "$question",
  },
};

function definition(
  rendererVersion: number | undefined,
  question: unknown,
): GuidedFlowDefinition {
  return {
    id: "example-record",
    version: 3,
    title: "Example record",
    steps: [
      {
        id: "question",
        title: "Question",
        explanation: "Choose the correct answer.",
        rendererSlug: "question-select",
        ...(rendererVersion ? { rendererVersion } : {}),
        rendererData: { question },
        actions: [{ id: "submit", target: { type: "complete" } }],
      },
    ],
  };
}

describe("GuidedFlow renderer compatibility", () => {
  it("rejects custom renderers that were not pinned by the flow definition", () => {
    const flow = definition(undefined, {
      taskId: "example",
      questionId: "q1",
    });

    expect(
      evaluateGuidedFlowCompatibility({
        definition: flow,
        instance: createGuidedFlowInstance(flow, "instance-1"),
        renderers: { "question-select": QUESTION_RENDERER },
      }),
    ).toMatchObject({
      status: "incompatible",
      code: "renderer_version_unpinned",
    });
  });

  it("rejects a renderer version that differs from the pinned version", () => {
    const flow = definition(1, {
      taskId: "example",
      questionId: "q1",
    });

    expect(
      evaluateGuidedFlowCompatibility({
        definition: flow,
        instance: createGuidedFlowInstance(flow, "instance-1"),
        renderers: { "question-select": QUESTION_RENDERER },
      }),
    ).toMatchObject({
      status: "incompatible",
      code: "renderer_version_mismatch",
    });
  });

  it("validates structured renderer input before a widget is mounted", () => {
    const flow = definition(2, {
      prompt: "What is 2 + 2?",
      options: [3, 4, 5],
    });

    expect(
      evaluateGuidedFlowCompatibility({
        definition: flow,
        instance: createGuidedFlowInstance(flow, "instance-1"),
        renderers: { "question-select": QUESTION_RENDERER },
      }),
    ).toMatchObject({
      status: "incompatible",
      code: "renderer_data_invalid",
    });
  });

  it("accepts a pinned renderer with valid structured input", () => {
    const flow = definition(2, {
      taskId: "example",
      questionId: "q1",
    });

    expect(
      evaluateGuidedFlowCompatibility({
        definition: flow,
        instance: createGuidedFlowInstance(flow, "instance-1"),
        renderers: { "question-select": QUESTION_RENDERER },
      }),
    ).toEqual({ status: "compatible" });
  });
});
