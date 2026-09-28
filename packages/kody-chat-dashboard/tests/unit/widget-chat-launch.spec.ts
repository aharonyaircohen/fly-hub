import { describe, expect, it } from "vitest";
import {
  buildWidgetPreviewView,
  isWidgetPreviewView,
  isWidgetOpenRequest,
} from "../../src/dashboard/lib/widgets/chat-launch";

describe("isWidgetOpenRequest", () => {
  it("accepts only valid widget slugs", () => {
    expect(isWidgetOpenRequest({ widgetSlug: "question-select" })).toBe(true);
    expect(
      isWidgetOpenRequest({
        widgetSlug: "question-select",
        conversationId: "conversation-1",
      }),
    ).toBe(true);
    expect(
      isWidgetOpenRequest({
        widgetSlug: "question-select",
        conversationId: "",
      }),
    ).toBe(false);
    expect(isWidgetOpenRequest({ widgetSlug: "../secret" })).toBe(false);
    expect(isWidgetOpenRequest({ widgetSlug: "" })).toBe(false);
    expect(isWidgetOpenRequest(null)).toBe(false);
  });
});

describe("buildWidgetPreviewView", () => {
  it("creates a local rendered view for one widget", () => {
    expect(buildWidgetPreviewView("question-select")).toEqual({
      action: "render_view",
      view: "renderer",
      id: "widget-preview:question-select",
      rendererSlug: "widget-preview",
      rendererName: "question-select",
      resultTarget: "chat",
      ui: {
        type: "widget",
        widget: "question-select",
        preview: true,
      },
      data: {},
    });
  });

  it("rejects invalid widget slugs", () => {
    expect(buildWidgetPreviewView("../secret")).toBeNull();
    expect(buildWidgetPreviewView("")).toBeNull();
  });

  it("identifies only Kody's local widget preview view", () => {
    const preview = buildWidgetPreviewView("question-select");
    expect(isWidgetPreviewView(preview)).toBe(true);
    expect(
      isWidgetPreviewView(
        preview ? { ...preview, rendererSlug: "record-question" } : null,
      ),
    ).toBe(false);
    expect(isWidgetPreviewView(null)).toBe(false);
  });
});
