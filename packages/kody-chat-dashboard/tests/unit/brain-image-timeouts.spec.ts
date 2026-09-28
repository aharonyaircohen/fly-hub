import { describe, expect, it } from "vitest";

import {
  BRAIN_IMAGE_JOB_OUTPUT_BYTES,
  brainImageJobTimeoutMs,
  DEFAULT_BRAIN_IMAGE_JOB_TIMEOUT_MS,
} from "@kody-ade/brain/image-timeouts";

describe("brainImageJobTimeoutMs", () => {
  it("defaults to a full-image friendly timeout", () => {
    expect(DEFAULT_BRAIN_IMAGE_JOB_TIMEOUT_MS).toBe(2 * 60 * 60_000);
    expect(brainImageJobTimeoutMs(undefined)).toBe(2 * 60 * 60_000);
  });

  it("allows an explicit bounded timeout", () => {
    expect(brainImageJobTimeoutMs("600000")).toBe(600_000);
    expect(brainImageJobTimeoutMs("1000")).toBe(5 * 60_000);
    expect(brainImageJobTimeoutMs(String(3 * 60 * 60_000))).toBe(
      2 * 60 * 60_000,
    );
  });

  it("keeps output capture large enough for image command logs", () => {
    expect(BRAIN_IMAGE_JOB_OUTPUT_BYTES).toBe(8 * 1024 * 1024);
  });
});
