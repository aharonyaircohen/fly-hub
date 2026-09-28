import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("workflow event dashboard surfaces", () => {
  it("shows the compact event summary on the home page", () => {
    const source = read("src/dashboard/lib/components/DashboardHome.tsx");
    expect(source).toContain('from "./WorkflowEvents"');
    expect(source).toContain("<WorkflowEventsOverview />");
  });

  it("keeps the detailed event history in Activity", () => {
    const source = read("src/dashboard/lib/components/ActivityPage.tsx");
    expect(source).toContain('"events"');
    expect(source).toContain("<WorkflowEventsView />");
    expect(source).toContain('"Events"');
  });

  it("does not render the stored event input payload", () => {
    const source = read("src/dashboard/lib/components/WorkflowEvents.tsx");
    expect(source).not.toContain("event.input");
    expect(source).toContain("event.sourceUrl");
  });
});
