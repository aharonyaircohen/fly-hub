import { describe, expect, it } from "vitest";

import { fullTimestamp } from "@dashboard/lib/inbox/presentation";

describe("fullTimestamp", () => {
  it("shows the entry's exact local date and time", () => {
    const sentAt = "2026-08-08T17:52:59.000Z";

    expect(fullTimestamp(sentAt)).toBe(
      new Date(sentAt).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  });

  it("returns an empty label for an invalid timestamp", () => {
    expect(fullTimestamp("not-a-date")).toBe("");
  });
});
