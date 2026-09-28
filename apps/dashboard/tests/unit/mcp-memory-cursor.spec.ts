import { describe, expect, it } from "vitest";
import {
  decodeMemoryCursor,
  encodeMemoryCursor,
} from "../../src/dashboard/lib/mcp/memory-cursor";

describe("memory pagination cursor", () => {
  it("retains position only for the same authorized scope", () => {
    const state = {
      binding: "repository:a/b",
      index: 0,
      cursor: "backend-position",
    };
    const cursor = encodeMemoryCursor(state, "test-key");
    expect(decodeMemoryCursor(cursor, state.binding, "test-key")).toEqual(
      state,
    );
    expect(() =>
      decodeMemoryCursor(cursor, "repository:other/private", "test-key"),
    ).toThrow();
    expect(() =>
      decodeMemoryCursor(`x${cursor}`, state.binding, "test-key"),
    ).toThrow();
    expect(() =>
      decodeMemoryCursor(cursor, state.binding, "rotated-key"),
    ).toThrow();
  });
});
