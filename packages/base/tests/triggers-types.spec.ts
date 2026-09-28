import { describe, expect, it } from "vitest";
import { triggerConfigSchema } from "../src/triggers/types";

describe("pipeline trigger concurrency", () => {
  it("accepts an input field as the Pipeline concurrency key", () => {
    const parsed = triggerConfigSchema.parse({
      id: "repair-ci",
      name: "Repair CI",
      enabled: true,
      event: "github.workflow_run.completed",
      conditions: [],
      action: {
        type: "start-pipeline",
        pipelineId: "ci-repair",
        inputMap: { branch: "payload.branch" },
        concurrencyKey: "branch",
      },
    });

    expect(parsed.action).toMatchObject({ concurrencyKey: "branch" });
  });
});
