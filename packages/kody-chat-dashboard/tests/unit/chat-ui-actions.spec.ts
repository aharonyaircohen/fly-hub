/**
 * Unit tests for chat UI directive validators.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_NAVIGATE_DIRECTIVE,
  RENDER_VIEW_DIRECTIVE,
  getRenderedViewUi,
  isDashboardNavigateDirective,
  isPreviewActDirective,
  isRenderedViewDirective,
} from "../../src/dashboard/lib/chat-ui-actions";

describe("isDashboardNavigateDirective", () => {
  it("accepts internal dashboard navigation directives", () => {
    expect(
      isDashboardNavigateDirective({
        action: DASHBOARD_NAVIGATE_DIRECTIVE,
        routeId: "secrets",
        href: "/secrets",
        label: "Secrets",
        reason: "Opening the secrets vault.",
      }),
    ).toBe(true);
  });

  it("rejects external-style hrefs", () => {
    expect(
      isDashboardNavigateDirective({
        action: DASHBOARD_NAVIGATE_DIRECTIVE,
        routeId: "bad",
        href: "//evil.test",
        label: "Bad",
        reason: "Nope.",
      }),
    ).toBe(false);
  });
});

describe("isPreviewActDirective", () => {
  it("accepts a repository media upload emitted by a Capability", () => {
    expect(
      isPreviewActDirective({
        action: "preview_act",
        op: "upload",
        selector: 'input[type="file"]',
        paths: ["content-studio/post/01-cover.jpg"],
        capabilitySlug: "prepare-facebook-personal-post",
        reason: "Attach the selected post media",
      }),
    ).toBe(true);
  });
});

describe("isRenderedViewDirective", () => {
  it("accepts an opaque control dispatch without knowing its behavior", () => {
    expect(
      isRenderedViewDirective({
        action: RENDER_VIEW_DIRECTIVE,
        view: "renderer",
        id: "guided-flow-view",
        rendererSlug: "approval-card",
        rendererName: "Approval card",
        resultTarget: "guided-flow",
        guidedFlow: { instanceId: "instance-1", stepId: "step-2", revision: 1 },
        ui: {
          type: "button",
          label: "Back",
          action: {
            id: "guided-flow-control-back",
            label: "Back",
            response: "back",
            dispatch: { type: "control", id: "back" },
          },
        },
        data: {},
      }),
    ).toBe(true);
  });

  it("rejects malformed control dispatch metadata", () => {
    expect(
      isRenderedViewDirective({
        action: RENDER_VIEW_DIRECTIVE,
        view: "renderer",
        id: "guided-flow-view",
        rendererSlug: "approval-card",
        rendererName: "Approval card",
        resultTarget: "guided-flow",
        guidedFlow: { instanceId: "instance-1", stepId: "step-2", revision: 1 },
        ui: {
          type: "button",
          label: "Back",
          action: {
            id: "guided-flow-control-back",
            label: "Back",
            response: "back",
            dispatch: { type: "control" },
          },
        },
        data: {},
      }),
    ).toBe(false);
  });

  it("accepts a generic renderer view directive", () => {
    expect(
      isRenderedViewDirective({
        action: RENDER_VIEW_DIRECTIVE,
        view: "renderer",
        id: "view-1",
        rendererSlug: "my-renderer",
        rendererName: "My renderer",
        resultTarget: "chat",
        ui: {
          type: "stack",
          children: [
            { type: "text", value: "Choose next step", variant: "title" },
            {
              type: "button",
              label: "Continue",
              action: {
                id: "continue",
                label: "Continue",
                response: "continue",
                variant: "primary",
              },
            },
            {
              type: "checkbox",
              name: "selected",
              value: "one",
              label: "Option one",
            },
            { type: "submit", label: "Confirm" },
          ],
        },
        data: {
          title: "Choose next step",
          body: "Pick one option before continuing.",
          actions: [
            {
              id: "continue",
              label: "Continue",
              response: "continue",
              variant: "primary",
            },
          ],
          items: [
            {
              id: "one",
              label: "Option one",
              response: "one",
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("accepts a durable generic result and rejects malformed results", () => {
    const completedView = {
      action: RENDER_VIEW_DIRECTIVE,
      view: "renderer",
      id: "view-1",
      rendererSlug: "question-select",
      rendererName: "Question",
      resultTarget: "chat",
      ui: { type: "widget", widget: "question-select" },
      data: {},
      result: {
        actionId: "correct",
        data: { selectedOptionIds: ["option-1"] },
        completedAt: "2026-08-01T12:00:00.000Z",
      },
    };

    expect(isRenderedViewDirective(completedView)).toBe(true);
    expect(
      isRenderedViewDirective({
        ...completedView,
        result: { actionId: "correct" },
      }),
    ).toBe(false);
  });

  it("rejects unknown renderer block types and unsafe result targets", () => {
    expect(
      isRenderedViewDirective({
        action: RENDER_VIEW_DIRECTIVE,
        view: "renderer",
        id: "view-1",
        rendererSlug: "my-renderer",
        rendererName: "My renderer",
        resultTarget: "api",
        ui: { type: "text", value: "Unsafe target" },
        data: {},
      }),
    ).toBe(false);
  });

  it("returns the generic UI atoms from the directive", () => {
    const ui = getRenderedViewUi({
      action: RENDER_VIEW_DIRECTIVE,
      view: "renderer",
      id: "view-1",
      rendererSlug: "my-renderer",
      rendererName: "My renderer",
      resultTarget: "chat",
      ui: {
        type: "stack",
        children: [
          { type: "text", value: "Choose next step", variant: "title" },
          {
            type: "text",
            value: "Pick one option before continuing.",
            variant: "body",
          },
          {
            type: "row",
            children: [
              {
                type: "button",
                label: "Continue",
                action: {
                  id: "continue",
                  label: "Continue",
                  response: "continue",
                  variant: "primary",
                },
              },
            ],
          },
        ],
      },
      data: {
        title: "Choose next step",
        body: "Pick one option before continuing.",
        actions: [
          {
            id: "continue",
            label: "Continue",
            response: "continue",
            variant: "primary",
          },
        ],
        items: [
          {
            id: "one",
            label: "Option one",
            response: "one",
          },
        ],
      },
    });

    expect(ui).toMatchObject({
      type: "stack",
      children: [
        { type: "text", value: "Choose next step", variant: "title" },
        {
          type: "text",
          value: "Pick one option before continuing.",
          variant: "body",
        },
        {
          type: "row",
          children: [
            {
              type: "button",
              label: "Continue",
              action: { id: "continue" },
            },
          ],
        },
      ],
    });
  });
});
