import { describe, expect, it } from "vitest";
import { compilePreparedTurnPayload } from "../../src/dashboard/lib/chat/core/conversation/prepared-turn-payload";
import { preparedTurnFixture } from "../fixtures/prepared-turn";

describe("compilePreparedTurnPayload", () => {
  it("keeps current, active history, and previous-agent context separate", () => {
    const payload = compilePreparedTurnPayload({
      ...preparedTurnFixture,
      activeHistory: [
        {
          ...preparedTurnFixture.currentMessage,
          id: "active-1",
          seq: 1,
          content: "Current-agent history",
        },
      ],
      previousAgentContext: [
        {
          ...preparedTurnFixture.currentMessage,
          id: "previous-1",
          seq: 0,
          content: "Old-agent history",
        },
      ],
      currentMessage: {
        ...preparedTurnFixture.currentMessage,
        id: "current",
        seq: 2,
        content: "Actual request",
      },
    });

    expect(payload.messages.map((message) => message.content)).toEqual([
      "Current-agent history",
      "Actual request",
    ]);
    expect(payload.previousAgentContext).toContain("Old-agent history");
    expect(payload.previousAgentContext).not.toContain("Actual request");
  });
});
