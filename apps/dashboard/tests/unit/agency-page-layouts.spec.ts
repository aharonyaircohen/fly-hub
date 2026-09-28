import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dashboardRoot = path.resolve(import.meta.dirname, "../..");

function source(relativePath: string) {
  return fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
}

describe("agency page layouts", () => {
  it("keeps Loops in the shared master-detail layout", () => {
    const loops = source(
      "src/dashboard/features/agency/components/LoopsPage.tsx",
    );

    expect(loops).toContain("MasterDetailShell");
    expect(loops).toContain("selectedId");
    expect(loops).not.toContain('<main className="mx-auto');
  });

  it("keeps Intents in the shared file-workspace layout", () => {
    const intents = source(
      "src/dashboard/features/agency/components/IntentFilesView.tsx",
    );

    expect(intents).toContain("AgentGuidanceFilesView");
    expect(intents).toContain("INTENTS_DEFINITION");
    expect(intents).not.toContain("PageShell");
    expect(intents).not.toContain("AgencyOverview");
  });
});
