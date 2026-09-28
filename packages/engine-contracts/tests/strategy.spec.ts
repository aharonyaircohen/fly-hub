import { describe, expect, it } from "vitest";

import { validateStrategyBlueprint } from "../src/strategy.js";

const validBlueprint = {
  schemaVersion: 1,
  kind: "strategy-blueprint",
  id: "healthy-ci",
  version: "1.0.0",
  name: "Healthy CI",
  outcome: "The repository has native CI that stays healthy.",
  instructions: "instructions.md",
  constraints: ["Preserve repository security policy."],
  application: {
    workflowId: "apply-strategy",
    workflowInput: { waitForCi: true, ciTimeoutSeconds: 1800 },
    activate: [{ kind: "solution", id: "ci-repair" }],
  },
  verification: {
    criteria: ["The generated CI passes on the proposed commit."],
  },
  compatibility: {
    repositoryTypes: ["javascript", "typescript"],
    providers: ["github-actions"],
  },
};

describe("validateStrategyBlueprint", () => {
  it("accepts the minimal executable Blueprint contract", () => {
    expect(validateStrategyBlueprint(validBlueprint)).toEqual([]);
  });

  it("rejects a Blueprint without an application Workflow", () => {
    expect(
      validateStrategyBlueprint({
        ...validBlueprint,
        application: { activate: [] },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "invalid_workflow_id",
        path: "application.workflowId",
      }),
    );
  });

  it("rejects unsupported activation kinds", () => {
    expect(
      validateStrategyBlueprint({
        ...validBlueprint,
        application: {
          workflowId: "apply-strategy",
          activate: [{ kind: "strategy", id: "nested" }],
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "invalid_activation",
        path: "application.activate[0]",
      }),
    );
  });

  it("rejects non-object Workflow input", () => {
    expect(
      validateStrategyBlueprint({
        ...validBlueprint,
        application: {
          ...validBlueprint.application,
          workflowInput: "wait",
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "invalid_workflow_input",
        path: "application.workflowInput",
      }),
    );
  });

  it("requires concrete proof criteria", () => {
    expect(
      validateStrategyBlueprint({
        ...validBlueprint,
        verification: { criteria: [] },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "verification_required",
        path: "verification.criteria",
      }),
    );
  });
});
