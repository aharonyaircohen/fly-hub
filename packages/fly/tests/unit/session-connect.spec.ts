import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isFlyBridgeAuthError,
  terminalMachineWakeAction,
  waitForServerProviderMachineHealth,
} from "../../src/terminal/session-connect";

describe("terminal machine readiness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits through a waking health endpoint before allowing terminal setup", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("starting", { status: 503 }))
      .mockResolvedValueOnce(new Response("ready", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await waitForServerProviderMachineHealth("brain-test", 3_000);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toEqual(
      new URL("/healthz", "https://brain-test.fly.dev"),
    );
  });

  it("reports a machine that never becomes healthy as not ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("closed")),
    );

    await expect(
      waitForServerProviderMachineHealth("brain-test", 1_100),
    ).rejects.toMatchObject({
      code: "machine_not_running",
      status: 409,
    });
  });
});

describe("terminal Fly access classification", () => {
  it("does not treat transient network failures as credential failures", () => {
    expect(isFlyBridgeAuthError(new Error("fetch failed: Connect Timeout"))).toBe(
      false,
    );
    expect(isFlyBridgeAuthError(new Error("read ECONNRESET"))).toBe(false);
    expect(
      isFlyBridgeAuthError(new Error("Fly Machines API 403 on /apps/brain")),
    ).toBe(true);
  });
});

describe("terminal machine wake transitions", () => {
  it("starts after a shutdown transition reaches a suspended state", () => {
    expect(terminalMachineWakeAction("suspending", false)).toBe("wait");
    expect(terminalMachineWakeAction("suspended", false)).toBe("start");
    expect(terminalMachineWakeAction("suspended", true)).toBe("wait");
    expect(terminalMachineWakeAction("started", true)).toBe("ready");
  });
});
