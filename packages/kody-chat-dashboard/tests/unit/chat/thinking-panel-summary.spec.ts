import { describe, expect, it } from "vitest";
import { getThinkingPanelSummary } from "../../../src/dashboard/lib/components/ToolCallCard";

describe("getThinkingPanelSummary", () => {
  it("names the specialist while delegated work is running", () => {
    expect(
      getThinkingPanelSummary({
        toolCalls: [
          {
            name: "subagent",
            arguments: {},
            status: "running",
            activityKind: "subagent",
            displayName: "Agency Specialist",
          },
        ],
      }),
    ).toBe("Agency Specialist working…");
  });

  it("names the specialist after delegated work completes", () => {
    expect(
      getThinkingPanelSummary({
        toolCalls: [
          {
            name: "subagent",
            arguments: {},
            status: "success",
            activityKind: "subagent",
            displayName: "Agency Specialist",
          },
        ],
      }),
    ).toBe("Agency Specialist completed");
  });
});
