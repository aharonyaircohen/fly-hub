import { describe, expect, it } from "vitest";
import {
  appRunStage,
  deployedAppState,
  machineEventReason,
  runtimeAppName,
} from "@dashboard/lib/fly-hub-app-run-status";

describe("Fly Hub app run status", () => {
  it("makes an Eve failure without a Fly build explicit", () => {
    expect(appRunStage({ eveStatus: "failed", ready: false })).toEqual({
      stage: "eve_failed",
      explanation: "Eve stopped. Read its error and the machine details below.",
    });
    expect(
      appRunStage({
        eveStatus: "failed",
        eveError: "GatewayRateLimitError: Rate limit exceeded",
        ready: false,
      }).explanation,
    ).toContain("model hit its rate limit");
  });

  it("distinguishes an idle suspended app from a failed build", () => {
    expect(
      appRunStage({
        eveStatus: "completed",
        gatewayState: "suspended",
        ready: false,
      }).stage,
    ).toBe("sleeping");
    expect(
      appRunStage({
        eveStatus: "working",
        builderState: "failed",
        ready: false,
      }).stage,
    ).toBe("retrying");
    expect(
      appRunStage({ eveStatus: "failed", builderState: "failed", ready: false })
        .stage,
    ).toBe("build_failed");
    expect(
      appRunStage({ eveStatus: "failed", ready: true }).explanation,
    ).toContain("previously deployed app");
  });

  it("uses the builder's runtime app name", () => {
    expect(runtimeAppName("flyhub-app-fly-apps-hello-fly-0865f109ec9d")).toBe(
      "flyhub-app-fly-apps-hello-fly-0865f109ec9d-rt-f109ec9d",
    );
  });

  it("explains why Fly stopped or suspended a machine", () => {
    expect(
      machineEventReason({
        type: "exit",
        status: "stopped",
        source: "flyd",
        timestamp: 1,
        exitCode: 0,
      }),
    ).toContain("finished successfully");
    expect(
      machineEventReason({
        type: "suspension",
        status: "suspended",
        source: "proxy",
        timestamp: 2,
      }),
    ).toContain("paused this idle machine");
    expect(
      machineEventReason({
        type: "exit",
        status: "stopped",
        source: "flyd",
        timestamp: 3,
        oomKilled: true,
      }),
    ).toContain("out of memory");
  });
});

it("does not hide failed or cancelled runs behind existing machine states", () => {
  expect(
    appRunStage({
      eveStatus: "failed",
      builderState: "failed",
      gatewayState: "stopped",
      runtimeState: "failed",
      ready: false,
    }).stage,
  ).toBe("build_failed");
  expect(
    appRunStage({
      eveStatus: "cancelled",
      gatewayState: "started",
      ready: false,
    }).stage,
  ).toBe("cancelled");
  expect(
    appRunStage({
      eveStatus: "completed",
      gatewayState: "started",
      runtimeState: "failed",
      ready: false,
    }).stage,
  ).toBe("app_failed");
  expect(
    appRunStage({
      eveStatus: "completed",
      gatewayState: "started",
      runtimeState: "stopped",
      ready: false,
    }).stage,
  ).toBe("app_stopped");
});
it("does not label an old responding app Ready during a new build", () => {
  expect(
    appRunStage({
      eveStatus: "working",
      builderState: "building",
      gatewayState: "started",
      runtimeState: "started",
      ready: true,
    }).stage,
  ).toBe("building");
});
it("includes runtime health in the deployed app state", () => {
  expect(deployedAppState("started", ["failed"])).toBe("failed");
  expect(deployedAppState("started", ["stopped"])).toBe("stopped");
  expect(deployedAppState("started", [])).toBe("unavailable");
  expect(deployedAppState("started", ["started"])).toBe("started");
});
