import { describe, expect, it } from "vitest";

import {
  effectiveActiveWorkflowIds,
  isBuiltInWorkflow,
} from "@dashboard/features/workflows/built-in-workflows";

describe("built-in workflows", () => {
  it("makes Quality Run active without repository configuration", () => {
    expect([...effectiveActiveWorkflowIds(undefined)]).toEqual(["quality-run"]);
  });

  it("preserves configured workflows without duplicating built-ins", () => {
    expect(
      [...effectiveActiveWorkflowIds(["ci-repair", "quality-run"])],
    ).toEqual(["ci-repair", "quality-run"]);
  });

  it("identifies only the built-in Quality Run workflow", () => {
    expect(isBuiltInWorkflow("quality-run")).toBe(true);
    expect(isBuiltInWorkflow("ci-repair")).toBe(false);
  });
});
