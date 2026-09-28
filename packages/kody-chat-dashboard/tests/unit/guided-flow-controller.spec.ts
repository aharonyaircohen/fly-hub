import { describe, expect, it } from "vitest";
import {
  advanceGuidedFlow,
  cancelGuidedFlow,
  createGuidedFlowInstance,
  goBackGuidedFlow,
  type GuidedFlowDefinition,
} from "../../src/dashboard/lib/guided-flows/controller";
import {
  enterNestedGuidedFlow,
  GuidedFlowCompositionError,
  resumeParentGuidedFlow,
} from "../../src/dashboard/lib/guided-flows/composition";

const DEFINITION: GuidedFlowDefinition = {
  id: "example-flow",
  version: 1,
  title: "Example flow",
  steps: [
    {
      id: "start",
      title: "Start",
      explanation: "Choose where to begin.",
      rendererSlug: "selection-list",
      actions: [{ id: "continue", target: { type: "step", stepId: "finish" } }],
    },
    {
      id: "finish",
      title: "Finish",
      explanation: "Review the result.",
      rendererSlug: "approval-card",
      actions: [{ id: "approve", target: { type: "complete" } }],
    },
  ],
};

describe("guided flow controller", () => {
  it("records a command result without leaving the current step", () => {
    const definition: GuidedFlowDefinition = {
      id: "initialize",
      version: 1,
      title: "Initialize",
      steps: [
        {
          id: "run-init",
          type: "command",
          title: "Initialize Kody",
          explanation: "Run initialization.",
          command: "/init",
          actions: [
            { id: "run", target: { type: "stay" } },
            { id: "continue", target: { type: "complete" } },
          ],
        },
      ],
    };

    expect(
      advanceGuidedFlow(
        definition,
        createGuidedFlowInstance(definition, "instance-1"),
        { actionId: "run", result: { status: "completed", summary: "Ready" } },
      ),
    ).toMatchObject({
      currentStepId: "run-init",
      status: "active",
      revision: 1,
      data: {
        stepResults: {
          "initialize@1/run-init": {
            actionId: "run",
            result: { status: "completed", summary: "Ready" },
          },
        },
      },
    });
  });

  it("creates an active instance at the definition start step", () => {
    expect(createGuidedFlowInstance(DEFINITION, "instance-1")).toMatchObject({
      instanceId: "instance-1",
      flowId: "example-flow",
      flowVersion: 1,
      currentStepId: "start",
      status: "active",
      revision: 0,
      data: {},
      backStack: [],
    });
  });

  it("advances through a validated transition and stores non-sensitive data", () => {
    const instance = createGuidedFlowInstance(DEFINITION, "instance-1");

    const next = advanceGuidedFlow(DEFINITION, instance, {
      actionId: "continue",
      result: { choice: "workflow" },
    });

    expect(next).toMatchObject({
      currentStepId: "finish",
      status: "active",
      revision: 1,
      data: {
        choice: "workflow",
        stepResults: {
          "example-flow@1/start": {
            actionId: "continue",
            result: { choice: "workflow" },
          },
        },
      },
      backStack: ["start"],
    });
  });

  it("rejects an unknown transition without changing state", () => {
    const instance = createGuidedFlowInstance(DEFINITION, "instance-1");

    expect(() =>
      advanceGuidedFlow(DEFINITION, instance, { actionId: "unknown" }),
    ).toThrow("Unknown action");
  });

  it("completes on an allowed action that has no continuing transition", () => {
    const definition: GuidedFlowDefinition = {
      id: "branching-task",
      version: 1,
      title: "Branching task",
      steps: [
        {
          id: "question",
          title: "Question",
          explanation: "Choose an answer.",
          rendererSlug: "question-select",
          actions: [
            { id: "correct", target: { type: "complete" } },
            { id: "incorrect", target: { type: "step", stepId: "hint" } },
          ],
        },
        {
          id: "hint",
          title: "Hint",
          explanation: "Try again.",
          rendererSlug: "approval-card",
          actions: [
            { id: "retry", target: { type: "step", stepId: "question" } },
          ],
        },
      ],
    };

    expect(
      advanceGuidedFlow(
        definition,
        createGuidedFlowInstance(definition, "instance-1"),
        { actionId: "correct", result: { selectedOptionId: "four" } },
      ),
    ).toMatchObject({
      status: "completed",
      output: { selectedOptionId: "four" },
    });
  });

  it("supports back and increments the revision", () => {
    const instance = advanceGuidedFlow(
      DEFINITION,
      createGuidedFlowInstance(DEFINITION, "instance-1"),
      { actionId: "continue", result: { choice: "workflow" } },
    );

    expect(goBackGuidedFlow(DEFINITION, instance)).toMatchObject({
      currentStepId: "start",
      revision: 2,
      backStack: [],
      status: "active",
    });
  });

  it("completes when the current step has no next step", () => {
    const instance = createGuidedFlowInstance(DEFINITION, "instance-1");
    const atFinish = advanceGuidedFlow(DEFINITION, instance, {
      actionId: "continue",
    });

    expect(
      advanceGuidedFlow(DEFINITION, atFinish, { actionId: "approve" }),
    ).toMatchObject({ status: "completed", revision: 2 });
  });

  it("cancels an active flow and rejects further changes", () => {
    const instance = createGuidedFlowInstance(DEFINITION, "instance-1");
    const cancelled = cancelGuidedFlow(instance);

    expect(cancelled).toMatchObject({ status: "cancelled", revision: 1 });
    expect(() => goBackGuidedFlow(DEFINITION, cancelled)).toThrow("not active");
  });

  it("rejects undeclared terminal actions and does not retain sensitive fields", () => {
    const instance = advanceGuidedFlow(
      DEFINITION,
      createGuidedFlowInstance(DEFINITION, "instance-1"),
      { actionId: "continue", result: { token: "secret", choice: "workflow" } },
    );

    expect(() =>
      advanceGuidedFlow(DEFINITION, instance, { actionId: "cancel" }),
    ).toThrow("Unknown action");

    const completed = advanceGuidedFlow(DEFINITION, instance, {
      actionId: "approve",
      result: { password: "hidden", note: "kept" },
    });
    expect(completed.data).toMatchObject({ note: "kept" });
    expect(completed.data).not.toHaveProperty("password");
  });

  it("enters a child flow while preserving the parent state", () => {
    const parent: GuidedFlowDefinition = {
      id: "parent",
      version: 1,
      title: "Parent",
      steps: [
        {
          id: "child",
          type: "flow",
          title: "Run child",
          explanation: "Complete the child flow.",
          flowId: "child",
          flowVersion: 1,
          actions: [
            { id: "complete", target: { type: "step", stepId: "summary" } },
          ],
        },
        {
          id: "summary",
          title: "Summary",
          explanation: "Done.",
          rendererSlug: "approval-card",
          actions: [{ id: "finish", target: { type: "complete" } }],
        },
      ],
    };
    const child: GuidedFlowDefinition = {
      id: "child",
      version: 1,
      title: "Child",
      steps: [
        {
          id: "answer",
          title: "Answer",
          explanation: "Choose.",
          rendererSlug: "selection-list",
          actions: [{ id: "submit", target: { type: "complete" } }],
        },
      ],
    };

    const nested = enterNestedGuidedFlow(
      parent,
      createGuidedFlowInstance(parent, "instance-1"),
      child,
    );

    expect(nested).toMatchObject({
      instanceId: "instance-1",
      flowId: "child",
      flowVersion: 1,
      currentStepId: "answer",
      revision: 0,
      stack: [
        {
          flowId: "parent",
          flowVersion: 1,
          currentStepId: "child",
        },
      ],
    });
  });

  it("returns a completed child result to the waiting parent", () => {
    const parent: GuidedFlowDefinition = {
      id: "parent",
      version: 1,
      title: "Parent",
      steps: [
        {
          id: "child",
          type: "flow",
          title: "Run child",
          explanation: "Complete the child flow.",
          flowId: "child",
          flowVersion: 1,
          actions: [
            { id: "complete", target: { type: "step", stepId: "summary" } },
          ],
        },
        {
          id: "summary",
          title: "Summary",
          explanation: "Done.",
          rendererSlug: "approval-card",
          actions: [{ id: "finish", target: { type: "complete" } }],
        },
      ],
    };
    const child: GuidedFlowDefinition = {
      id: "child",
      version: 1,
      title: "Child",
      steps: [
        {
          id: "answer",
          title: "Answer",
          explanation: "Choose.",
          rendererSlug: "selection-list",
          actions: [{ id: "submit", target: { type: "complete" } }],
        },
      ],
    };
    const nested = enterNestedGuidedFlow(
      parent,
      createGuidedFlowInstance(parent, "instance-1"),
      child,
    );
    const completedChild = advanceGuidedFlow(child, nested, {
      actionId: "submit",
      result: { answer: "four" },
    });

    const resumed = resumeParentGuidedFlow(parent, completedChild);

    expect(resumed).toMatchObject({
      flowId: "parent",
      flowVersion: 1,
      currentStepId: "summary",
      status: "active",
      revision: 1,
      stack: [],
      data: {
        flowResults: {
          child: {
            flowId: "child",
            flowVersion: 1,
            status: "completed",
            output: { answer: "four" },
          },
        },
      },
      backStack: ["child"],
    });
  });

  it("completes a parent whose nested step has no next transition", () => {
    const parent: GuidedFlowDefinition = {
      id: "record",
      version: 1,
      title: "Record",
      steps: [
        {
          id: "task",
          type: "flow",
          title: "Task",
          explanation: "Complete the task.",
          flowId: "task",
          flowVersion: 1,
          actions: [{ id: "complete", target: { type: "complete" } }],
        },
      ],
    };
    const child: GuidedFlowDefinition = {
      id: "task",
      version: 1,
      title: "Task",
      steps: [
        {
          id: "question",
          title: "Question",
          explanation: "Choose.",
          rendererSlug: "question-select",
          actions: [{ id: "correct", target: { type: "complete" } }],
        },
      ],
    };
    const nested = enterNestedGuidedFlow(
      parent,
      createGuidedFlowInstance(parent, "instance-1"),
      child,
    );
    const completedChild = advanceGuidedFlow(child, nested, {
      actionId: "correct",
      result: { selectedOptionId: "four" },
    });

    expect(resumeParentGuidedFlow(parent, completedChild)).toMatchObject({
      flowId: "record",
      status: "completed",
      stack: [],
    });
  });

  it("rejects recursive nesting", () => {
    const recursive: GuidedFlowDefinition = {
      id: "recursive",
      version: 1,
      title: "Recursive",
      steps: [
        {
          id: "again",
          type: "flow",
          title: "Again",
          explanation: "Run itself.",
          flowId: "recursive",
          flowVersion: 1,
          actions: [{ id: "complete", target: { type: "complete" } }],
        },
      ],
    };

    try {
      enterNestedGuidedFlow(
        recursive,
        createGuidedFlowInstance(recursive, "instance-1"),
        recursive,
      );
      throw new Error("Expected recursive nesting to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(GuidedFlowCompositionError);
      expect((error as GuidedFlowCompositionError).code).toBe("recursive_flow");
    }
  });
});
