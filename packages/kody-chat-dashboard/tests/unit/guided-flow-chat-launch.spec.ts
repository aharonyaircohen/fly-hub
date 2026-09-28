import { describe, expect, it } from "vitest";
import type { Message } from "../../src/dashboard/lib/components/kody-chat-types";
import {
  guidedFlowMessageId,
  isGuidedFlowChatMessage,
  locationAfterGuidedFlowLaunch,
  replaceGuidedFlowChatMessage,
  shouldAutoResumeGuidedFlows,
} from "../../src/dashboard/lib/guided-flows/chat-launch";

describe("GuidedFlow automatic resume", () => {
  it("does not resume an old active flow while a new start request is pending", () => {
    expect(
      shouldAutoResumeGuidedFlows({
        hydrated: true,
        activeSessionId: "conversation-1",
        lockedAgentSlug: null,
        messageCount: 0,
        guidedFlowRequest: {
          flowId: "onboarding",
          message: "started",
        },
      }),
    ).toBe(false);
  });

  it("resumes an active flow when Chat opens normally", () => {
    expect(
      shouldAutoResumeGuidedFlows({
        hydrated: true,
        activeSessionId: "conversation-1",
        lockedAgentSlug: null,
        messageCount: 0,
        guidedFlowRequest: null,
      }),
    ).toBe(true);
  });
});

describe("GuidedFlow chat launch location", () => {
  it("keeps a definition launch so a new conversation starts the flow again", () => {
    expect(
      locationAfterGuidedFlowLaunch(
        "/repo/acme/widgets/chat",
        "?guidedFlow=record&instanceKey=student-1",
      ),
    ).toBe("/repo/acme/widgets/chat?guidedFlow=record&instanceKey=student-1");
  });

  it("consumes an exact instance launch without removing unrelated params", () => {
    expect(
      locationAfterGuidedFlowLaunch(
        "/repo/acme/widgets/chat",
        "?guidedFlowInstanceId=instance-1&panel=chat",
      ),
    ).toBe("/repo/acme/widgets/chat?panel=chat");
  });

  it("consumes a one-time definition launch", () => {
    expect(
      locationAfterGuidedFlowLaunch(
        "/chat",
        "?guidedFlow=onboarding&guidedFlowOnce=1",
      ),
    ).toBe("/chat");
  });
});

describe("GuidedFlow chat messages", () => {
  const guidedView = {
    resultTarget: "guided-flow",
  } as Message["view"];

  it("recognizes flow status messages and rendered flow cards", () => {
    expect(
      isGuidedFlowChatMessage({
        content: "GuidedFlow completed.",
      }),
    ).toBe(true);
    expect(isGuidedFlowChatMessage({ content: "Step", view: guidedView })).toBe(
      true,
    );
    expect(isGuidedFlowChatMessage({ content: "Normal assistant reply" })).toBe(
      false,
    );
  });

  it("replaces old flow messages while preserving normal chat", () => {
    const previous: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "GuidedFlow completed." },
      {
        role: "assistant",
        content: "Your private Chat is ready",
        view: guidedView,
      },
      { role: "assistant", content: "Keep this reply" },
    ];
    const next = {
      role: "assistant" as const,
      content: "GuidedFlow started. Follow the steps below.",
      view: guidedView,
    };

    expect(replaceGuidedFlowChatMessage(previous, next)).toEqual([
      previous[0],
      previous[3],
      next,
    ]);
  });
});

describe("GuidedFlow message identity", () => {
  it("uses the rendered view ID as the durable message ID", () => {
    expect(
      guidedFlowMessageId({
        role: "assistant",
        content: "GuidedFlow started. Follow the steps below.",
        view: { resultTarget: "guided-flow", id: "view-1" } as Message["view"],
      }),
    ).toBe("guided-flow:view-1");
  });
});
