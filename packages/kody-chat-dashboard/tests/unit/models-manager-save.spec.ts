import { afterEach, describe, expect, it, vi } from "vitest";

import { saveEngineModels } from "../../src/dashboard/lib/components/ModelsManager";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveEngineModels", () => {
  it("rejects a successful response when the Engine config did not sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            engineSyncWarning: "Engine config could not be updated",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      saveEngineModels(
        { "Content-Type": "application/json" },
        [],
        { default: false, engineDefault: false },
      ),
    ).rejects.toThrow("Engine config could not be updated");
  });
});
