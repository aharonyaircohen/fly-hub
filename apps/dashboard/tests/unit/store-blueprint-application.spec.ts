import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BLUEPRINT_APPLY_TIMEOUT_MS,
  applyStoreBlueprint,
} from "@dashboard/lib/store-blueprint-application";

describe("applyStoreBlueprint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails with a phase-specific timeout when engine installation hangs", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const pending = applyStoreBlueprint({}, {
      slug: "healthy-ci",
    } as Parameters<typeof applyStoreBlueprint>[1]);
    const failure = expect(pending).rejects.toThrow(
      "Blueprint apply timed out while installing the Kody engine",
    );
    await vi.advanceTimersByTimeAsync(BLUEPRINT_APPLY_TIMEOUT_MS);

    await failure;
    vi.useRealTimers();
  });
});
