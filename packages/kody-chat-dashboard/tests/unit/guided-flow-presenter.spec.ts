import { describe, expect, it } from "vitest";

import { presentGuidedFlow } from "../../app/api/kody/guided-flows/presenter";
import { promoteGuidedFlowExplanationToMarkdown } from "../../src/dashboard/lib/guided-flows/presentation";
import {
  advanceGuidedFlow,
  createGuidedFlowInstance,
  type GuidedFlowDefinition,
  type GuidedFlowViewStepDefinition,
} from "../../src/dashboard/lib/guided-flows/controller";
import { getGuidedFlowDefinition } from "../../src/dashboard/lib/guided-flows/registry";

const DEFINITION: GuidedFlowDefinition = {
  id: "navigation-flow",
  version: 1,
  title: "Navigation flow",
  completionRouteId: "chat",
  steps: [
    {
      id: "welcome",
      title: "Welcome",
      explanation: "Start here.",
      rendererSlug: "approval-card",
      rendererData: {
        body: "This legacy body must not become a second instruction source.",
      },
      actions: [{ id: "next", target: { type: "step", stepId: "configure" } }],
    },
    {
      id: "configure",
      title: "Configure",
      explanation: "Complete the page, then click Next.",
      rendererSlug: "approval-card",
      routeId: "secrets",
      actions: [{ id: "next", target: { type: "complete" } }],
    },
  ],
};

describe("GuidedFlow presenter navigation", () => {
  it("renders Guide instructions as Markdown even when a renderer uses text", () => {
    expect(
      promoteGuidedFlowExplanationToMarkdown(
        {
          type: "stack",
          children: [
            { type: "text", variant: "title", value: "Select parent" },
            { type: "text", value: "**Choose a parent**" },
          ],
        },
        "**Choose a parent**",
      ),
    ).toEqual({
      type: "stack",
      children: [
        { type: "text", variant: "title", value: "Select parent" },
        { type: "markdown", value: "**Choose a parent**" },
      ],
    });
  });
  it("presents command execution before manual continuation", () => {
    const definition: GuidedFlowDefinition = {
      id: "initialize",
      version: 1,
      title: "Initialize",
      steps: [
        {
          id: "run-init",
          type: "command",
          title: "Initialize Kody",
          explanation: "Run initialization, then continue.",
          command: "/init",
          actions: [
            { id: "run", target: { type: "stay" } },
            { id: "continue", target: { type: "complete" } },
          ],
        },
      ],
    };
    const started = createGuidedFlowInstance(definition, "instance-1");
    const initialView = presentGuidedFlow(definition, started).view;

    expect(initialView).toMatchObject({
      rendererSlug: "guided-flow-command",
      data: {
        command: "/init",
        status: "ready",
        actions: [{ id: "run", label: "Run command" }],
      },
    });

    const executed = advanceGuidedFlow(definition, started, {
      actionId: "run",
      result: { status: "completed", summary: "Kody Engine is ready." },
    });
    expect(presentGuidedFlow(definition, executed).view).toMatchObject({
      data: {
        status: "completed",
        summary: "Kody Engine is ready.",
        actions: [
          { id: "run", label: "Run again" },
          { id: "continue", label: "Continue" },
        ],
      },
    });
  });

  it("does not offer Continue when a command needs attention", () => {
    const definition: GuidedFlowDefinition = {
      id: "initialize-warning",
      version: 1,
      title: "Initialize",
      steps: [
        {
          id: "run-init",
          type: "command",
          title: "Initialize Kody",
          explanation: "Resolve every required setup result.",
          command: "/init",
          actions: [
            { id: "run", target: { type: "stay" } },
            { id: "continue", target: { type: "complete" } },
          ],
        },
      ],
    };
    const warning = advanceGuidedFlow(
      definition,
      createGuidedFlowInstance(definition, "instance-warning"),
      {
        actionId: "run",
        result: {
          status: "needs_attention",
          summary: "Webhook FAILED — Not Found (HTTP 404).",
        },
      },
    );

    expect(presentGuidedFlow(definition, warning).view).toMatchObject({
      data: {
        status: "needs_attention",
        summary: "Webhook FAILED — Not Found (HTTP 404).",
        actions: [{ id: "run", label: "Run again" }],
      },
    });
  });

  it("offers approval when a workflow command returns an approval challenge", () => {
    const definition: GuidedFlowDefinition = {
      id: "workflow-approval",
      version: 1,
      title: "Run workflow",
      steps: [
        {
          id: "course",
          title: "Course",
          explanation: "Choose a course.",
          rendererSlug: "selection-list",
          actions: [
            { id: "continue", target: { type: "step", stepId: "chapter" } },
          ],
        },
        {
          id: "chapter",
          title: "Chapter",
          explanation: "Choose a chapter.",
          rendererSlug: "selection-list",
          actions: [
            { id: "continue", target: { type: "step", stepId: "lesson" } },
          ],
        },
        {
          id: "lesson",
          title: "Lesson",
          explanation: "Name the lesson.",
          rendererSlug: "guided-form",
          actions: [
            { id: "continue", target: { type: "step", stepId: "pdf" } },
          ],
        },
        {
          id: "pdf",
          title: "PDF",
          explanation: "Choose a PDF.",
          rendererSlug: "guided-form",
          actions: [
            {
              id: "continue",
              target: { type: "step", stepId: "run-workflow" },
            },
          ],
        },
        {
          id: "run-workflow",
          type: "command",
          title: "Run operation",
          explanation: "Approve the workflow to run the operation.",
          command: "/run-workflow custom-workflow",
          actions: [
            { id: "run", target: { type: "stay" } },
            { id: "continue", target: { type: "complete" } },
          ],
        },
      ],
    };
    const warning = advanceGuidedFlow(
      definition,
      {
        ...createGuidedFlowInstance(definition, "instance-approval"),
        currentStepId: "run-workflow",
        data: {
          chapterId: "chapter-1",
          chapterIdLabel: "Algebra",
          courseId: "course-1",
          courseIdLabel: "Five units",
          lessonName: "Linear equations",
          pdfPath: "materials/lesson.pdf",
          pdfPathName: "lesson.pdf",
          apiToken: "must-not-be-rendered",
          stepResults: {
            "workflow-approval@1/course": {
              result: { courseId: "course-1", courseIdLabel: "Five units" },
            },
            "workflow-approval@1/chapter": {
              result: { chapterId: "chapter-1", chapterIdLabel: "Algebra" },
            },
            "workflow-approval@1/lesson": {
              result: {
                lessonName: "Linear equations",
                apiToken: "must-not-be-rendered",
              },
            },
            "workflow-approval@1/pdf": {
              result: {
                pdfPath: "materials/lesson.pdf",
                pdfPathName: "lesson.pdf",
              },
            },
          },
        },
      },
      {
        actionId: "run",
        result: {
          status: "needs_attention",
          summary: "The workflow is ready.",
          approvalChallenge: "challenge",
        },
      },
    );

    expect(presentGuidedFlow(definition, warning).view).toMatchObject({
      data: {
        reviewTitle: "Review before running",
        review: [
          { label: "Course", value: "Five units" },
          { label: "Chapter", value: "Algebra" },
          { label: "Lesson name", value: "Linear equations" },
          { label: "PDF", value: "lesson.pdf" },
        ],
        actions: [
          { id: "approve", label: "Approve and run" },
          { id: "run", label: "Run again" },
        ],
      },
    });
  });

  it("navigates to the page owned by the active step", () => {
    const started = createGuidedFlowInstance(DEFINITION, "instance-1");
    const atConfigure = advanceGuidedFlow(DEFINITION, started, {
      actionId: "next",
    });

    expect(presentGuidedFlow(DEFINITION, atConfigure).navigation).toEqual({
      action: "dashboard_navigate",
      routeId: "secrets",
      href: "/secrets",
      label: "Secrets",
      reason: "Open Configure",
    });
  });

  it("opens Files in picker mode only when the step requests a file", () => {
    const definition: GuidedFlowDefinition = {
      ...DEFINITION,
      steps: [
        {
          ...(DEFINITION.steps[0] as GuidedFlowViewStepDefinition),
          routeId: "files",
          filePicker: { resultField: "selectedFile", extensions: [".txt"] },
        },
      ],
    };
    const started = createGuidedFlowInstance(definition, "instance-1");

    expect(presentGuidedFlow(definition, started).navigation?.href).toBe(
      "/files?guidedFlowPicker=1&instanceId=instance-1&stepId=welcome&revision=0&resultField=selectedFile&extensions=.txt",
    );
  });

  it("fills a dynamic page from the step's typed parameters", () => {
    const definition: GuidedFlowDefinition = {
      ...DEFINITION,
      steps: [
        {
          ...DEFINITION.steps[0],
          routeId: "task",
          routeParameters: { issueNumber: "42" },
        },
      ],
    };
    const started = createGuidedFlowInstance(definition, "instance-1");

    expect(presentGuidedFlow(definition, started).navigation).toMatchObject({
      routeId: "task",
      href: "/42",
      label: "Task #42",
    });
  });

  it("does not navigate when the active step has no page", () => {
    const started = createGuidedFlowInstance(DEFINITION, "instance-1");

    expect(presentGuidedFlow(DEFINITION, started).navigation).toBeUndefined();
  });

  it("opens a workflow command page only after approval starts the run", () => {
    const definition: GuidedFlowDefinition = {
      id: "workflow-navigation",
      version: 1,
      title: "Run workflow",
      steps: [
        {
          id: "run-workflow",
          type: "command",
          title: "Run workflow",
          explanation: "Start the workflow.",
          command: "/run-workflow extract-pdf-exercises",
          routeId: "workflows",
          actions: [{ id: "run", target: { type: "stay" } }],
        },
      ],
    };
    const started = createGuidedFlowInstance(definition, "instance-1");

    expect(presentGuidedFlow(definition, started).navigation).toBeUndefined();

    const awaitingApproval = advanceGuidedFlow(definition, started, {
      actionId: "run",
      result: {
        status: "needs_attention",
        workflowId: "extract-pdf-exercises",
        approvalChallenge: "challenge",
      },
    });

    expect(
      presentGuidedFlow(definition, awaitingApproval).navigation,
    ).toBeUndefined();

    const running = advanceGuidedFlow(definition, awaitingApproval, {
      actionId: "run",
      result: {
        status: "running",
        workflowId: "extract-pdf-exercises",
        runId: "run-1",
      },
    });
    expect(presentGuidedFlow(definition, running).navigation).toMatchObject({
      routeId: "workflows",
      href: "/workflows/extract-pdf-exercises",
    });
  });

  it("keeps the user in place after completing UI login setup", () => {
    const definition = getGuidedFlowDefinition("setup-ui-login");
    expect(definition).not.toBeNull();

    const started = createGuidedFlowInstance(definition!, "instance-1");
    const atUsername = advanceGuidedFlow(definition!, started, {
      actionId: "setup",
    });
    const atPassword = advanceGuidedFlow(definition!, atUsername, {
      actionId: "continue",
    });
    const atReady = advanceGuidedFlow(definition!, atPassword, {
      actionId: "continue",
    });
    const completed = advanceGuidedFlow(definition!, atReady, {
      actionId: "finish",
    });

    expect(completed.status).toBe("completed");
    expect(
      presentGuidedFlow(definition!, completed).navigation,
    ).toBeUndefined();
  });

  it("renders the step explanation once as the instruction source", () => {
    const started = createGuidedFlowInstance(DEFINITION, "instance-1");
    const rendered = JSON.stringify(
      presentGuidedFlow(DEFINITION, started).view?.ui,
    );

    expect(rendered.match(/Start here\./g)).toHaveLength(1);
    expect(rendered).not.toContain("legacy body");
  });

  it("rejects an invalid active-step page instead of silently ignoring it", () => {
    const invalidDefinition: GuidedFlowDefinition = {
      ...DEFINITION,
      steps: [
        {
          ...DEFINITION.steps[0],
          routeId: "not-a-dashboard-page",
        },
      ],
    };
    const started = createGuidedFlowInstance(invalidDefinition, "instance-1");

    expect(() => presentGuidedFlow(invalidDefinition, started)).toThrow(
      'Unknown dashboard route "not-a-dashboard-page"',
    );
  });
});
