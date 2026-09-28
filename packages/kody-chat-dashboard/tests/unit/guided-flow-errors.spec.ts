import { describe, expect, it } from "vitest";
import { guidedFlowActionErrorMessage } from "../../src/dashboard/lib/guided-flows/errors";

describe("guided flow action errors", () => {
  it("turns validation failures into an actionable message", () => {
    expect(guidedFlowActionErrorMessage("invalid_guided_flow_input")).toBe(
      "Please complete the current step before continuing.",
    );
  });

  it("never exposes internal error codes", () => {
    const message = guidedFlowActionErrorMessage("guided_flow_action_failed");
    expect(message).toBe(
      "We couldn't continue this Guided Flow. Your progress is saved; please try again.",
    );
    expect(message).not.toContain("guided_flow_action_failed");
  });

  it("explains known completion failures without exposing backend details", () => {
    expect(guidedFlowActionErrorMessage("guided_flow_workflow_exists")).toBe(
      "A workflow with this name already exists. Choose a different name and try again.",
    );
    expect(guidedFlowActionErrorMessage("guided_flow_invalid_workflow")).toBe(
      "This workflow cannot be created with the selected capability. Check the capability and try again.",
    );
  });

  it("explains rejected and unavailable controls", () => {
    expect(guidedFlowActionErrorMessage("guided_flow_control_disabled")).toBe(
      "This control is not enabled for this Guided Flow.",
    );
    expect(
      guidedFlowActionErrorMessage("guided_flow_control_unavailable"),
    ).toBe("This control is not available at the current step.");
  });
});
