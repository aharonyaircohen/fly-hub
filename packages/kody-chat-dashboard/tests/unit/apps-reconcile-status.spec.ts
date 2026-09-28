import { describe, expect, it } from "vitest";
import {
  reconciledAppStatus,
  visibleAppStatus,
} from "../../src/dashboard/lib/apps/reconcile-status";

it("shows verification while the current deployment is being checked", () => {
  expect(visibleAppStatus("deploying", "verifying")).toBe("verifying");
  expect(visibleAppStatus("running", "running")).toBe("running");
});

describe("reconciledAppStatus", () => {
  const runtime = { state: "started", config: { env: {} } };
  const gateway = {
    state: "started",
    config: { env: { KODY_APP_TOKEN_HASHES: "hash" } },
  };

  it("keeps a private app deploying until its gateway is ready", () => {
    expect(
      reconciledAppStatus({
        current: "deploying",
        exposure: "private",
        machines: [runtime],
        builderState: "building",
      }),
    ).toBe("deploying");
  });

  it("marks a private app running from its isolated authenticated gateway", () => {
    expect(
      reconciledAppStatus({
        current: "deploying",
        exposure: "private",
        machines: [gateway],
        builderState: "failed",
      }),
    ).toBe("running");
  });
});
