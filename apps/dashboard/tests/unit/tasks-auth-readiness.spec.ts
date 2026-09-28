import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const hooksSource = readFileSync(
  join(process.cwd(), "src/dashboard/lib/hooks/index.ts"),
  "utf8",
);
const dashboardSource = readFileSync(
  join(process.cwd(), "src/dashboard/lib/components/KodyDashboard.tsx"),
  "utf8",
);

describe("task query auth ownership", () => {
  it("lets the auth provider own readiness instead of polling browser storage", () => {
    expect(hooksSource).toContain("authReady?: boolean");
    expect(hooksSource).toContain(
      "enabled: enabled && (authReady ?? !!getStoredAuth())",
    );
    expect(dashboardSource).toContain(
      "authReady: !!storedAuth",
    );
  });

  it("loads the board summary without blocking on per-task preview details", () => {
    expect(dashboardSource).toContain("includeDetails: false");
    expect(dashboardSource).toContain("TaskDetail fetches the full");
    expect(dashboardSource).toContain("record on selection");
  });
});
