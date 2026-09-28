import { describe, expect, it } from "vitest";

import {
  formatExecutableWorkflowIssues,
  validateExecutableWorkflow,
} from "../src/index";

describe("validateExecutableWorkflow", () => {
  const validWorkflow = {
    name: "CI Repair",
    agent: "operations-specialist",
    capabilities: ["ci-health-check", "repair-ci", "create-pr"],
    startAt: "check",
    steps: [
      {
        id: "check",
        capability: "ci-health-check",
        next: [
          { to: "repair", when: { "result.status": "failed" } },
          { to: "$end", default: true },
        ],
      },
      {
        id: "repair",
        capability: "repair-ci",
        next: [{ to: "publish" }],
      },
      { id: "publish", capability: "create-pr" },
    ],
  };

  it("accepts a complete workflow graph", () => {
    expect(validateExecutableWorkflow(validWorkflow)).toEqual([]);
  });

  it("allows a condition without Otherwise so no match can block", () => {
    const workflow = structuredClone(validWorkflow);
    workflow.steps[0].next = [
      { to: "repair", when: { "result.status": "failed" } },
    ];

    expect(validateExecutableWorkflow(workflow)).toEqual([]);
  });

  it("rejects unknown and undeclared capabilities", () => {
    const workflow = structuredClone(validWorkflow);
    workflow.capabilities = ["ci-health-check", "repair-ci"];

    expect(
      validateExecutableWorkflow(workflow, {
        knownCapabilities: new Set(["ci-health-check", "repair-ci"]),
      }).map((issue) => issue.code),
    ).toEqual(expect.arrayContaining(["undeclared_capability", "unknown_capability"]));
  });

  it("rejects unbounded backward connections", () => {
    const workflow = structuredClone(validWorkflow);
    workflow.steps[2].next = [{ to: "check" }];

    expect(validateExecutableWorkflow(workflow)).toContainEqual(
      expect.objectContaining({ code: "unbounded_loop" }),
    );
  });

  it("formats exact issues for user-facing errors", () => {
    expect(
      formatExecutableWorkflowIssues([
        { code: "broken", path: "steps[0]", message: "is invalid" },
      ]),
    ).toEqual(["steps[0]: is invalid"]);
  });
});
