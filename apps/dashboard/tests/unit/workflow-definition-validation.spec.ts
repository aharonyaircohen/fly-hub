import { describe, expect, it } from "vitest";

import {
  buildWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowStepDefinition,
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
  workflowStepDefinitionSchema,
} from "../../src/dashboard/lib/workflow-definitions";

function workflow(
  steps: WorkflowStepDefinition[],
  startAt = "inspect",
): WorkflowDefinition {
  return {
    name: "Agent workflow",
    agent: "kody",
    capabilities: ["inspect", "repair", "publish"],
    startAt,
    steps,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("validateWorkflowDefinition", () => {
  it("preserves a required approval on its exact step", () => {
    const normalized = normalizeWorkflowDefinition({
      name: "Publish",
      agent: "content-editor",
      capabilities: ["validate", "publish"],
      startAt: "validate",
      steps: [
        { id: "validate", capability: "validate", next: [{ to: "publish" }] },
        { id: "publish", capability: "publish", approval: "required" },
      ],
    });

    expect(normalized?.steps?.[1]?.approval).toBe("required");
  });

  it("builds a runnable ordered workflow when simple creation omits steps", () => {
    const built = buildWorkflowDefinition({
      name: "QA pass",
      capabilities: ["inspect", "repair"],
    });

    expect(built.steps).toEqual([
      {
        id: "inspect",
        capability: "inspect",
        next: [{ to: "repair", default: true }],
      },
      {
        id: "repair",
        capability: "repair",
        next: [{ to: "$end", default: true }],
      },
    ]);
    expect(built.startAt).toBe("inspect");
    expect(validateWorkflowDefinition(built)).toEqual([]);
  });

  it("keeps one capability input value", () => {
    expect(
      normalizeWorkflowDefinition({
        name: "Release",
        agent: "kody",
        capabilities: ["inspect"],
        steps: [
          {
            id: "inspect",
            capability: "inspect",
            input: { prefer: "ours" },
          },
        ],
      })?.steps?.[0]?.input,
    ).toEqual({ prefer: "ours" });
  });

  it("preserves explicit generic step input mappings", () => {
    expect(
      normalizeWorkflowDefinition({
        name: "Repair",
        agent: "kody",
        capabilities: ["inspect", "repair"],
        steps: [
          { id: "inspect", capability: "inspect" },
          {
            id: "repair",
            capability: "repair",
            inputs: {
              request: { from: "workflow.input.request" },
              findings: { from: "steps.inspect.result.findings" },
            },
          },
        ],
      })?.steps?.[1]?.inputs,
    ).toEqual({
      request: { from: "workflow.input.request" },
      findings: { from: "steps.inspect.result.findings" },
    });
  });

  it("rejects an invalid or missing input source", () => {
    expect(
      validateWorkflowDefinition(
        workflow([
          {
            id: "inspect",
            capability: "inspect",
            inputs: {
              request: { from: "automatic.previous.output" },
              findings: { from: "steps.missing.result.findings" },
            },
          },
        ]),
      ).map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining(["invalid_input_source", "missing_input_step"]),
    );
  });

  it("preserves generic Engine execution policy on Store workflow steps", () => {
    expect(
      normalizeWorkflowDefinition({
        name: "Chore",
        agent: "kody",
        capabilities: ["run"],
        steps: [
          {
            id: "run",
            capability: "run",
            action: "run",
            evidence: "facts.issue_number",
            target: "issue",
            delivery: "pull-request",
            targetFact: "facts.issue_number",
            reason: "Implement and deliver the requested change.",
            timeoutSeconds: 600,
            runWhen: { "facts.ready": true },
            continueOn: ["completed"],
            saveReport: true,
            report: { channel: "workflow" },
          },
        ],
      })?.steps?.[0],
    ).toEqual({
      id: "run",
      capability: "run",
      action: "run",
      evidence: "facts.issue_number",
      target: "issue",
      delivery: "pull-request",
      targetFact: "facts.issue_number",
      reason: "Implement and deliver the requested change.",
      timeoutSeconds: 600,
      runWhen: { "facts.ready": true },
      continueOn: ["completed"],
      saveReport: true,
      report: { channel: "workflow" },
    });
  });

  it("accepts only bounded workflow step deadlines", () => {
    expect(
      workflowStepDefinitionSchema.safeParse({
        id: "repair",
        capability: "run",
        timeoutSeconds: 600,
      }).success,
    ).toBe(true);
    expect(
      workflowStepDefinitionSchema.safeParse({
        id: "repair",
        capability: "run",
        timeoutSeconds: 0,
      }).success,
    ).toBe(false);
  });

  it("accepts a complete branch and bounded loop", () => {
    expect(
      validateWorkflowDefinition(
        workflow([
          {
            id: "inspect",
            capability: "inspect",
            next: [
              { to: "repair", when: { "facts.needsFix": true } },
              { to: "publish", default: true },
            ],
          },
          {
            id: "repair",
            capability: "repair",
            next: [{ to: "inspect", maxIterations: 3 }],
          },
          { id: "publish", capability: "publish" },
        ]),
      ),
    ).toEqual([]);
  });

  it("preserves and accepts an explicit workflow end", () => {
    const normalized = normalizeWorkflowDefinition({
      name: "Review loop",
      agent: "kody",
      capabilities: ["review", "fix"],
      startAt: "review",
      steps: [
        {
          id: "review",
          capability: "review",
          next: [
            {
              to: "$end",
              when: { "result.verdict": "pass" },
            },
            { to: "fix", default: true },
          ],
        },
        {
          id: "fix",
          capability: "fix",
          next: [{ to: "review", default: true, maxIterations: 3 }],
        },
      ],
    });

    expect(normalized?.steps?.[0]?.next?.[0]).toEqual({
      to: "$end",
      when: { "result.verdict": "pass" },
    });
    expect(normalized && validateWorkflowDefinition(normalized)).toEqual([]);
  });

  it("preserves workflow-level report publication settings", () => {
    const report = {
      type: "agency-observer",
      version: 1,
      owner: "agency-observer",
      slug: "agency-observer",
      title: "Agency Observer",
    };
    const normalized = normalizeWorkflowDefinition({
      name: "Agency Observer",
      agent: "kody",
      capabilities: ["observe"],
      steps: [{ id: "observe", capability: "observe" }],
      report,
    });

    expect(normalized?.report).toEqual(report);
  });

  it.each([
    [
      workflow([
        { id: "inspect", capability: "inspect", next: [{ to: "missing" }] },
      ]),
      "missing_transition_target",
    ],
    [
      workflow([
        { id: "inspect", capability: "inspect", next: [{ to: "repair" }] },
        { id: "repair", capability: "repair", next: [{ to: "inspect" }] },
      ]),
      "unbounded_loop",
    ],
    [
      workflow([
        { id: "inspect", capability: "inspect", next: [{ to: "publish" }] },
        { id: "repair", capability: "repair" },
        { id: "publish", capability: "publish" },
      ]),
      "unreachable_step",
    ],
    [
      workflow([{ id: "inspect", capability: "not-declared" }]),
      "undeclared_capability",
    ],
  ] as const)("rejects invalid workflow %#", (value, code) => {
    expect(
      validateWorkflowDefinition(value).map((issue) => issue.code),
    ).toContain(code);
  });

  it("rejects a capability that is not installed in the agency", () => {
    expect(
      validateWorkflowDefinition(
        workflow([{ id: "inspect", capability: "inspect" }]),
        {
          knownCapabilities: new Set(["publish"]),
        },
      ).map((issue) => issue.code),
    ).toContain("unknown_capability");
  });
});
