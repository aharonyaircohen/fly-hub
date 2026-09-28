import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

describe("Workflow execution architecture", () => {
  it("keeps Workflow routes, state, and UI independent from Fly", () => {
    const files = [
      "app/api/kody/company/workflows/[id]/run/route.ts",
      "src/dashboard/lib/workflow-run-state.ts",
      "src/dashboard/lib/workflow-run-state-files.ts",
      "src/dashboard/features/workflows/components/WorkflowsManager.tsx",
    ];

    for (const relative of files) {
      const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
      expect(source, relative).not.toMatch(/@kody-ade\/fly|\bmachineId\b|kind:\s*"fly"/);
    }
    expect(
      fs.existsSync(
        path.join(
          ROOT,
          "app/api/kody/company/workflows/[id]/runs/[runId]/route.ts",
        ),
      ),
    ).toBe(false);
  });
});
