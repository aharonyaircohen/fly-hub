import { describe, expect, it } from "vitest";

import {
  journeyDefinitionSchema,
  journeyStatusFromRuns,
  type JourneyDefinition,
} from "../../../src/dashboard/lib/user-journeys/contracts";

const journey: JourneyDefinition = {
  id: "create-workflow",
  name: "Create a workflow",
  goal: "A user can create and review a workflow.",
  status: "active",
  priority: "critical",
  scenarios: [
    {
      id: "happy-path",
      name: "Happy path",
      kind: "happy",
      steps: [
        {
          id: "open",
          action: { type: "navigate", url: "/workflows" },
          assertions: [{ type: "visible", locator: { by: "role", role: "heading", name: "Workflows" } }],
        },
      ],
    },
  ],
};

describe("user journey contracts", () => {
  it("accepts a strict declarative journey definition", () => {
    expect(journeyDefinitionSchema.parse(journey)).toEqual(journey);
  });

  it("rejects arbitrary actions", () => {
    expect(() =>
      journeyDefinitionSchema.parse({
        ...journey,
        scenarios: [{ ...journey.scenarios[0], steps: [{ id: "bad", action: { type: "execute", code: "alert(1)" }, assertions: [] }] }],
      }),
    ).toThrow();
  });

  it("derives health from the latest relevant run", () => {
    expect(journeyStatusFromRuns([])).toBe("never_run");
    expect(journeyStatusFromRuns([{ status: "passed", version: 2 }])).toBe("passed");
    expect(journeyStatusFromRuns([{ status: "failed", version: 2 }])).toBe("failed");
    expect(journeyStatusFromRuns([{ status: "running", version: 2 }, { status: "passed", version: 1 }])).toBe("running");
  });
});
