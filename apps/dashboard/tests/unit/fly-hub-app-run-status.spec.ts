import { describe, expect, it } from "vitest";
import { appRunStage, runtimeAppName } from "@dashboard/lib/fly-hub-app-run-status";

describe("Fly Hub app run status", () => {
  it("makes an Eve failure without a Fly build explicit", () => {
    expect(appRunStage({ eveStatus: "failed", ready: false })).toEqual({
      stage: "eve_failed",
      explanation: "Eve stopped before a Fly app machine was created. The error is shown below.",
    });
    expect(appRunStage({ eveStatus: "failed", eveError: "GatewayRateLimitError: Rate limit exceeded", ready: false }).explanation)
      .toContain("model hit its rate limit");
  });

  it("distinguishes an idle suspended app from a failed build", () => {
    expect(appRunStage({ eveStatus: "completed", gatewayState: "suspended", ready: false }).stage).toBe("sleeping");
    expect(appRunStage({ eveStatus: "working", builderState: "failed", ready: false }).stage).toBe("retrying");
    expect(appRunStage({ eveStatus: "failed", builderState: "failed", ready: false }).stage).toBe("build_failed");
  });

  it("uses the builder's runtime app name", () => {
    expect(runtimeAppName("flyhub-app-fly-apps-hello-fly-0865f109ec9d"))
      .toBe("flyhub-app-fly-apps-hello-fly-0865f109ec9d-rt-f109ec9d");
  });
});
