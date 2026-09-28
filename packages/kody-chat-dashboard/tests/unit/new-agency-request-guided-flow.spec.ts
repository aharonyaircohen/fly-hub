import { describe, expect, it } from "vitest";
import {
  advanceGuidedFlow,
  createGuidedFlowInstance,
} from "../../src/dashboard/lib/guided-flows/controller";
import {
  NEW_AGENCY_REQUEST_FLOW,
  NEW_AGENCY_REQUEST_FLOW_ID,
} from "../../src/dashboard/lib/guided-flows/builtins/new-agency-request";

describe("New Agency Request GuidedFlow", () => {
  it("collects a one-time requirement and hands it to the Request Manager", () => {
    expect(NEW_AGENCY_REQUEST_FLOW).toMatchObject({
      id: NEW_AGENCY_REQUEST_FLOW_ID,
      onComplete: { action: "agency-request.submit" },
      controls: ["back"],
    });

    let instance = createGuidedFlowInstance(
      NEW_AGENCY_REQUEST_FLOW,
      "request-1",
    );
    instance = advanceGuidedFlow(NEW_AGENCY_REQUEST_FLOW, instance, {
      actionId: "continue",
    });

    const answers = [
      ["desiredOutcome", "Keep CI healthy"],
      ["activation", "Whenever CI fails on main"],
      ["allowedActions", "Create PRs; wait before merge"],
      ["successCriteria", "The latest main CI run is green"],
      ["additionalContext", "Use existing CI Repair when compatible"],
    ] as const;
    for (const [name, value] of answers) {
      instance = advanceGuidedFlow(NEW_AGENCY_REQUEST_FLOW, instance, {
        actionId: "submit",
        result: { [name]: value },
      });
    }

    expect(instance.status).toBe("completed");
    expect(instance.data).toMatchObject(Object.fromEntries(answers));
  });
});
