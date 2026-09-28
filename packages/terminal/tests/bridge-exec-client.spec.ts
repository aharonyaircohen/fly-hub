import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BridgeExecRequestError,
  getTerminalBridgeExecJob,
} from "../src/bridge-exec-client";

describe("terminal bridge exec client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves a missing job response as a typed 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: "job not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      getTerminalBridgeExecJob({
        bridgeUrl: "https://bridge.test",
        token: "token",
        jobId: "job-1",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BridgeExecRequestError>>({
        name: "BridgeExecRequestError",
        status: 404,
        code: "job_not_found",
      }),
    );
  });
});
