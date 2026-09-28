import { describe, expect, it } from "vitest";

import { createLatestFrameBuffer } from "../../src/browsers/frame-flow";

describe("browser frame flow control", () => {
  it("allows only one unacknowledged frame", () => {
    const frames = createLatestFrameBuffer<string>();

    expect(frames.push("frame-1")).toBe("frame-1");
    expect(frames.push("frame-2")).toBeNull();
  });

  it("releases only the newest queued frame", () => {
    const frames = createLatestFrameBuffer<string>();

    frames.push("frame-1");
    frames.push("frame-2");
    frames.push("frame-3");

    expect(frames.acknowledge()).toBe("frame-3");
    expect(frames.acknowledge()).toBeNull();
  });

  it("resumes immediate delivery after the queue drains", () => {
    const frames = createLatestFrameBuffer<string>();

    frames.push("frame-1");
    expect(frames.acknowledge()).toBeNull();

    expect(frames.push("frame-2")).toBe("frame-2");
  });
});
