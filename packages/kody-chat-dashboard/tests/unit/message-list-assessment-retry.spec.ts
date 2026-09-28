import { describe, expect, it } from "vitest";

import { getAssessmentWriterRetryTurnId } from "../../src/dashboard/lib/chat/surface/MessageList";

describe("assessment writer retry action", () => {
  it("targets only the failed assessment turn", () => {
    expect(
      getAssessmentWriterRetryTurnId({
        id: "provider-message-id",
        turnId: "failed-turn",
        role: "assistant",
        content:
          "<think>Writer details</think>\n\nFinal report writing failed: missing section ‘Product readiness’.",
      }),
    ).toBe("failed-turn");
    expect(
      getAssessmentWriterRetryTurnId({
        id: "assistant:other-turn",
        role: "assistant",
        content: "The provider failed.",
      }),
    ).toBeNull();
  });
});
