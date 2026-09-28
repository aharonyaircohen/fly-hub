import { describe, expect, it } from "vitest";

import {
  advanceGuidedFlow,
  createGuidedFlowInstance,
} from "../../src/dashboard/lib/guided-flows/controller";
import {
  CREATE_BLUEPRINT_FLOW,
  CREATE_BLUEPRINT_FLOW_ID,
  CREATE_BLUEPRINT_MODEL_GUIDE,
} from "../../src/dashboard/lib/request-blueprints/create-blueprint";

describe("Create Blueprint GuidedFlow", () => {
  it("collects the reusable brief, including follow-up answers", () => {
    expect(CREATE_BLUEPRINT_FLOW).toMatchObject({
      id: CREATE_BLUEPRINT_FLOW_ID,
      onComplete: { action: "agency-request.submit" },
    });

    let instance = createGuidedFlowInstance(
      CREATE_BLUEPRINT_FLOW,
      "create-blueprint-1",
    );
    instance = advanceGuidedFlow(CREATE_BLUEPRINT_FLOW, instance, {
      actionId: "continue",
    });

    const answers = [
      ["desiredOutcome", "Create reliable repository-native web releases"],
      ["activation", "When a release is requested"],
      ["allowedActions", "Create a PR; do not merge"],
      ["successCriteria", "The generated release passes end to end"],
      ["additionalContext", "Reuse existing Store components"],
    ] as const;
    for (const [name, value] of answers) {
      instance = advanceGuidedFlow(CREATE_BLUEPRINT_FLOW, instance, {
        actionId: "submit",
        result: { [name]: value },
      });
    }

    expect(instance.status).toBe("completed");
    expect(instance.data).toMatchObject(Object.fromEntries(answers));
    for (const [name] of answers) expect(CREATE_BLUEPRINT_MODEL_GUIDE).toContain(name);
  });
});
