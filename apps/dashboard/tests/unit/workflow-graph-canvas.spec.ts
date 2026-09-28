import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_PATH = path.resolve(
  process.cwd(),
  "src/dashboard/features/workflows/components/WorkflowGraphCanvas.tsx",
);

describe("WorkflowGraphCanvas", () => {
  it("uses React Flow with automatic layout and editable connections", () => {
    const source = fs.readFileSync(SOURCE_PATH, "utf8");

    expect(source).toContain("@xyflow/react");
    expect(source).toContain("elkjs/lib/elk.bundled.js");
    expect(source).toContain("onConnect");
    expect(source).toContain("How should this path run?");
    expect(source).toContain("When should this branch run?");
    expect(source).toContain("If no other branch matches");
    expect(source).toContain("Stop after");
    expect(source).toContain("Expected answer");
    expect(source).toContain("Advanced result rule");
    expect(source).toContain("Use a simple result check");
    expect(source).not.toContain("Result field");
    expect(source).not.toContain("Condition (JSON)");
    expect(source).not.toContain("Default connection");
    expect(source).not.toContain("Maximum repeats");
    expect(source).toContain("Position.Right");
    expect(source).toContain("Position.Left");
    expect(source).toContain("fitView");
    expect(source).toContain("Make starting step");
    expect(source).toContain("runState?.currentStepId");
    expect(source).toContain("runState?.completedStepIds");
    expect(source).toContain("DecisionNode");
    expect(source).toContain("When the previous step");
    expect(source).toContain("Choose a path");
    expect(source).toContain("promoteToDecision");
  });
});
