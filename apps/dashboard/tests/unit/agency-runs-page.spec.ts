import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  agencyRunDiagnosis,
  operatorRunFactLines,
} from "@dashboard/features/agency/components/AgencyRunsPage";
import type { AgencyRunSummary } from "@dashboard/lib/agency-runs";

const source = readFileSync(
  "src/dashboard/features/agency/components/AgencyRunsPage.tsx",
  "utf8",
);

function run(patch: Partial<AgencyRunSummary> = {}): AgencyRunSummary {
  return {
    id: "run-1",
    kind: "workflow",
    targetId: "release",
    targetLabel: "Release",
    targetModel: null,
    origin: "manual",
    status: "running",
    title: "Release",
    summary: null,
    currentStep: null,
    decision: null,
    startedAt: "2026-07-24T10:00:00.000Z",
    updatedAt: "2026-07-24T10:01:00.000Z",
    durationMs: 60_000,
    kodyRunId: "run-1",
    githubRunId: null,
    githubRunUrl: null,
    logUrl: null,
    statePath: null,
    sourcePath: "run-1",
    action: null,
    capability: null,
    workflow: "release",
    agent: "reviewer",
    model: null,
    modelProvider: null,
    modelName: null,
    reasoningEffort: null,
    actor: null,
    ...patch,
  };
}

describe("Agency Runs page", () => {
  it("shows only executable Agency boundaries", () => {
    expect(source).toContain('label: "Loops"');
    expect(source).toContain('label: "Workflows"');
    expect(source).toContain('label: "Capabilities"');
  });

  it("shows the Workflow Agent instead of an Implementation runtime", () => {
    expect(operatorRunFactLines(run())).toContain("Agent: reviewer.");
    expect(source).not.toContain("Capability revision:");
  });

  it("diagnoses a Todo handoff", () => {
    const diagnosis = agencyRunDiagnosis(
      run({
        status: "stuck",
        summary: "stuck waiting on todo release-proof",
      }),
      [],
    );
    expect(diagnosis.stoppedAt).toBe("Release -> release-proof");
    expect(diagnosis.owner).toBe("release-proof");
  });
});
