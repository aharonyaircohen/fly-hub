import { describe, expect, it } from "vitest";
import { createLatestRequestGuard } from "@dashboard/features/file-manager/lib/latest-request";

describe("createLatestRequestGuard", () => {
  it("invalidates older asynchronous requests", () => {
    const guard = createLatestRequestGuard();
    const first = guard.next();
    const second = guard.next();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("can invalidate the active request during cleanup", () => {
    const guard = createLatestRequestGuard();
    const request = guard.next();

    guard.invalidate();

    expect(guard.isCurrent(request)).toBe(false);
  });
});
