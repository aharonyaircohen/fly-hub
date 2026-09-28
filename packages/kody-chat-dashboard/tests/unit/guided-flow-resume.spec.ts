import { describe, expect, it } from "vitest";

import { buildGuidedFlowResumeView } from "../../src/dashboard/lib/guided-flows/resume";

describe("GuidedFlow resume presentation", () => {
  it("offers every compatible active flow instead of silently choosing one", () => {
    const view = buildGuidedFlowResumeView({
      sessionId: "chat-1",
      flows: [
        {
          instance: {
            instanceId: "record-1",
            revision: 3,
            status: "active",
          },
          flow: { title: "Power basics", stepIndex: 2, stepCount: 6 },
          compatibility: { status: "compatible" },
        },
        {
          instance: {
            instanceId: "task-1",
            revision: 1,
            status: "active",
          },
          flow: { title: "Example task", stepIndex: 0, stepCount: 2 },
          compatibility: { status: "compatible" },
        },
      ],
    });

    expect(view.data.actions).toMatchObject([
      {
        id: "resume",
        label: "Power basics · Step 3 of 6",
        result: { instanceId: "record-1" },
      },
      {
        id: "resume",
        label: "Example task · Step 1 of 2",
        result: { instanceId: "task-1" },
      },
    ]);
  });

  it("hides flows that cannot be resumed", () => {
    const view = buildGuidedFlowResumeView({
      sessionId: "chat-1",
      flows: [
        {
          instance: {
            instanceId: "old-demo",
            revision: 4,
            status: "active",
          },
          flow: { title: "Old demo", stepIndex: 0, stepCount: 1 },
          compatibility: {
            status: "incompatible",
            code: "renderer_version_unpinned",
            message: "Renderer was not versioned.",
          },
        },
      ],
    });

    expect(view.data.actions).toEqual([]);
  });

  it("shows only unfinished-flow actions", () => {
    const view = buildGuidedFlowResumeView({
      sessionId: "chat-1",
      flows: [
        {
          instance: {
            instanceId: "workflow-1",
            revision: 2,
            status: "active",
          },
          flow: { title: "Create a workflow", stepIndex: 0, stepCount: 2 },
          compatibility: { status: "compatible" },
        },
      ],
    });

    expect(view.data.actions).toMatchObject([
      { id: "resume", variant: "primary" },
    ]);
    expect(view.data.actions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "assess" })]),
    );
  });

  it("keeps caller-owned actions in the same card", () => {
    const view = buildGuidedFlowResumeView({
      sessionId: "chat-1",
      flows: [
        {
          instance: {
            instanceId: "workflow-1",
            revision: 2,
            status: "active",
          },
          flow: { title: "Create a workflow", stepIndex: 0, stepCount: 2 },
          compatibility: { status: "compatible" },
        },
      ],
      additionalActions: [
        {
          id: "run-project-assessment",
          label: "Run project assessment",
          response: "Run assessment",
          variant: "secondary",
        },
      ],
    });

    expect(view.data.actions).toMatchObject([
      { id: "resume" },
      { id: "run-project-assessment", variant: "secondary" },
    ]);
  });
});
