import { describe, expect, it } from "vitest";

import { guidedFlowChangeForViewAction } from "../../src/dashboard/lib/guided-flows/chat-action";

describe("GuidedFlow rendered action dispatch", () => {
  it("maps an opaque renderer control event without knowing the control behavior", () => {
    expect(
      guidedFlowChangeForViewAction({
        id: "flow-control-back",
        label: "Back",
        response: "back",
        dispatch: { type: "control", id: "back" },
      }),
    ).toEqual({ action: "control", controlId: "back" });
  });

  it("maps ordinary renderer actions to step submissions", () => {
    expect(
      guidedFlowChangeForViewAction({
        id: "approve",
        label: "Approve",
        response: "approve",
        result: { approved: true },
      }),
    ).toEqual({
      action: "submit",
      actionId: "approve",
      result: { approved: true },
    });
  });
});
