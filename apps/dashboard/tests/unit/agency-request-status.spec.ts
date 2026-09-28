import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/dashboard/features/tasks/components/TodoControl.tsx",
  ),
  "utf8",
);

describe("Agency request Todo status", () => {
  it("shows terminal evidence and blockers from the durable request state", () => {
    expect(source).toContain("list.agencyRequest.evidence");
    expect(source).toContain("Evidence");
    expect(source).toContain("list.agencyRequest.blockers");
    expect(source).toContain("Blockers");
  });

  it("links a completed Agency request to its report", () => {
    expect(source).toContain('ref.kind === "report"');
    expect(source).toContain("Completion report");
    expect(source).toContain("scopedHref(`/reports/${completionReport.id}`)");
  });
});
