import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  fileURLToPath(new URL("../../app/api/kody/chat/kody/route.ts", import.meta.url)),
  "utf8",
);

describe("assessment writer retry route", () => {
  it("preserves recovery before another writer-only attempt", () => {
    const retryStart = routeSource.indexOf("if (body.retryAssessmentTurnId)");
    const retryEnd = routeSource.indexOf(
      "const assignedSubagentSlugs",
      retryStart,
    );
    const retrySource = routeSource.slice(retryStart, retryEnd);

    expect(retrySource).toContain("await durableTurn?.saveRecovery(recovery)");
    expect(retrySource.indexOf("saveRecovery(recovery)")).toBeLessThan(
      retrySource.indexOf("retryProjectAssessmentSynthesis"),
    );
  });
});
