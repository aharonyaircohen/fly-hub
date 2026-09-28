import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detailSource = readFileSync(
  "src/dashboard/features/pipelines/components/PipelineDetail.tsx",
  "utf8",
);
const managerSource = readFileSync(
  "src/dashboard/features/pipelines/components/PipelinesManager.tsx",
  "utf8",
);

describe("Pipeline workflow names", () => {
  it("shows workflow names while keeping workflow ids as the link target", () => {
    expect(managerSource).toContain("workflows={workflows}");
    expect(detailSource).toContain(
      "workflowNames.get(step.workflow) ?? step.workflow",
    );
    expect(detailSource).toContain(
      "workflowNames.get(step.workflowId) ?? step.workflowId",
    );
    expect(detailSource).toContain('href={`/workflows/${step.workflow}`}');
  });
});
