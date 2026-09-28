import { describe, expect, it } from "vitest";

import { shouldFinalizeBrainRestoreFailure } from "@dashboard/lib/brain/restore-worker";

describe("Brain restore worker failure ownership", () => {
  it("keeps retryable attempts running until the durable queue exhausts them", () => {
    expect(shouldFinalizeBrainRestoreFailure(502, false)).toBe(false);
    expect(shouldFinalizeBrainRestoreFailure(429, false)).toBe(false);
    expect(shouldFinalizeBrainRestoreFailure(502, true)).toBe(true);
  });

  it("records permanent failures immediately", () => {
    expect(shouldFinalizeBrainRestoreFailure(403, false)).toBe(true);
    expect(shouldFinalizeBrainRestoreFailure(409, false)).toBe(true);
  });
});
