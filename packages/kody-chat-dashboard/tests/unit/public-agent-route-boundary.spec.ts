import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  fileURLToPath(
    new URL("../../app/api/kody/chat/kody/route.ts", import.meta.url),
  ),
  "utf8",
);

describe("public Agent route boundary", () => {
  it("keeps Kody in control of the same model turn", () => {
    expect(routeSource).toContain("createPublicAgentEvidenceTool");
    expect(routeSource).toContain("request_specialist_evidence");
    expect(routeSource).not.toContain("handleConfiguredPublicAgentChat");
    expect(routeSource).not.toContain("return specialistChat.response");
    expect(routeSource).not.toContain('from "./public-agent-delegation"');
    expect(routeSource).not.toContain('from "./public-agent-orchestrator"');
    expect(routeSource).not.toContain("routePublicAgentTask");
    expect(routeSource).not.toContain("runIsolatedPublicAgentTaskWithRetry");
    expect(routeSource).not.toContain("synthesizePublicAgentResponse");
  });

  it("passes authoritative current context into specialist evidence work", () => {
    expect(routeSource).toContain("const specialistUserText =");
    expect(routeSource).toContain("body.previewContext.trim()");
    expect(routeSource).toContain("sharedContext: specialistUserText");
  });

  it("does not retain a competing pre-turn specialist planner", () => {
    expect(routeSource).not.toContain("KODY_SINGLE_DELEGATION_PLANNER");
    expect(routeSource).not.toContain("planPublicAgentTurn");
    expect(routeSource).not.toContain("shouldRoutePublicAgentChat");
  });
});
