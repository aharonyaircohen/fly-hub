import { describe, expect, it } from "vitest";

import {
  isRenderedViewMessageActive,
  messageJustifyClass,
  shouldShowSilentAssistantNotice,
} from "../../src/dashboard/lib/chat/surface/MessageList";
import {
  RENDER_VIEW_DIRECTIVE,
  type RenderedViewDirective,
} from "../../src/dashboard/lib/chat-ui-actions";
import type { Message } from "../../src/dashboard/lib/components/kody-chat-types";

const widgetView: RenderedViewDirective = {
  action: RENDER_VIEW_DIRECTIVE,
  view: "renderer",
  id: "question-view",
  rendererSlug: "question-select",
  rendererName: "Question",
  resultTarget: "guided-flow",
  guidedFlow: {
    instanceId: "record-1",
    stepId: "question-1",
    revision: 0,
  },
  ui: { type: "widget", widget: "question-select" },
  data: {},
};

describe("message list role layout", () => {
  it("keeps dashboard chat user-right and assistant-left", () => {
    expect(messageJustifyClass("user", "dashboard")).toBe("justify-end");
    expect(messageJustifyClass("assistant", "dashboard")).toBe("justify-start");
  });

  it("uses client support chat visitor-left and brand-agent-right", () => {
    expect(messageJustifyClass("user", "client")).toBe("justify-start");
    expect(messageJustifyClass("assistant", "client")).toBe("justify-end");
  });
});

describe("active rendered view", () => {
  const viewMessage: Message = {
    role: "assistant",
    content: "Answer this question.",
    view: widgetView,
  };

  it("keeps the widget active after its non-closing assistant replies", () => {
    const messages: Message[] = [
      viewMessage,
      { role: "assistant", content: "That is not correct. Try again." },
    ];

    expect(isRenderedViewMessageActive(messages, 0, new Set<string>())).toBe(
      true,
    );
  });

  it("keeps the widget active when its Kody request is a hidden model turn", () => {
    const messages: Message[] = [
      viewMessage,
      {
        role: "user",
        content: "Widget request for Kody",
        hidden: true,
      },
      { role: "assistant", content: "Here is the requested explanation." },
    ];

    expect(isRenderedViewMessageActive(messages, 0, new Set<string>())).toBe(
      true,
    );
  });

  it("disables the widget after completion or a later user turn", () => {
    expect(
      isRenderedViewMessageActive([viewMessage], 0, new Set(["question-view"])),
    ).toBe(false);
    expect(
      isRenderedViewMessageActive(
        [viewMessage, { role: "user", content: "Something else" }],
        0,
        new Set<string>(),
      ),
    ).toBe(false);
  });

  it("keeps a completed widget disabled after conversation hydration", () => {
    const completedMessage: Message = {
      ...viewMessage,
      view: {
        ...widgetView,
        result: {
          actionId: "correct",
          completedAt: "2026-08-01T12:00:00.000Z",
        },
      },
    };

    expect(
      isRenderedViewMessageActive([completedMessage], 0, new Set<string>()),
    ).toBe(false);
  });

  it("keeps only the latest unresolved view active", () => {
    const messages: Message[] = [
      viewMessage,
      {
        ...viewMessage,
        view: { ...widgetView, id: "question-view-2" },
      },
    ];

    expect(isRenderedViewMessageActive(messages, 0, new Set<string>())).toBe(
      false,
    );
    expect(isRenderedViewMessageActive(messages, 1, new Set<string>())).toBe(
      true,
    );
  });
});

describe("silent assistant messages", () => {
  it("shows a visible outcome for a committed thought-only reply", () => {
    expect(
      shouldShowSilentAssistantNotice({
        isLoading: false,
        hasAnswer: false,
        hasView: false,
      }),
    ).toBe(true);
  });

  it("does not replace an in-flight reply with an error notice", () => {
    expect(
      shouldShowSilentAssistantNotice({
        isLoading: true,
        hasAnswer: false,
        hasView: false,
      }),
    ).toBe(false);
  });

  it("does not show the notice when an answer or view exists", () => {
    expect(
      shouldShowSilentAssistantNotice({
        isLoading: false,
        hasAnswer: true,
        hasView: false,
      }),
    ).toBe(false);
    expect(
      shouldShowSilentAssistantNotice({
        isLoading: false,
        hasAnswer: false,
        hasView: true,
      }),
    ).toBe(false);
  });

  it("recognizes a short progress sentence as an incomplete final result", () => {
    expect(
      shouldShowSilentAssistantNotice({
        isLoading: false,
        hasAnswer: true,
        hasView: false,
        hasTransientStatus: true,
      }),
    ).toBe(true);
  });
});
