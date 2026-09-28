import { describe, expect, it } from "vitest";
import {
  buildRepositoryChatOpeningView,
  PROJECT_ASSESSMENT_REQUEST,
} from "../../../src/dashboard/lib/chat/core/chat-opening";

describe("repository chat opening", () => {
  it("uses a generic renderer with a caller-owned assessment suggestion", () => {
    const view = buildRepositoryChatOpeningView("conversation-1");

    expect(view.rendererSlug).toBe("guided-flow-status");
    expect(view.id).toBe("chat-opening-conversation-1");
    expect(view.data).toMatchObject({
      greeting: "Hi! I can help you with:",
      actions: [
        {
          id: "run-project-assessment",
          label: "Run project assessment",
          response: PROJECT_ASSESSMENT_REQUEST,
        },
      ],
    });
  });

  it("adds host actions through the renderer action list", () => {
    const setupAction = {
      id: "setup-kody",
      label: "Setup Kody",
      response: "setup-kody",
      variant: "secondary" as const,
      result: { guidedFlowId: "initialize-kody-engine" },
    };

    const view = buildRepositoryChatOpeningView("conversation-1", [
      setupAction,
    ]);

    expect(view.data.actions).toEqual([
      expect.objectContaining({ id: "run-project-assessment" }),
      setupAction,
    ]);
  });

  it("builds a useful personal-chat opening without repository actions", () => {
    const view = buildRepositoryChatOpeningView("personal-conversation", [], {
      scope: "personal",
    });

    expect(view.data).toMatchObject({
      title: "Your private Chat",
      step: "Chat is ready. Ask Kody anything, or attach a repository when you need repository tools.",
      actions: [],
    });
  });
});
