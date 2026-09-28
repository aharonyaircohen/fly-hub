import { describe, expect, it } from "vitest";

import { parseEngineExecutionRequest } from "../src/index";

describe("parseEngineExecutionRequest", () => {
  it("accepts a correlated Workflow request without provider details", () => {
    expect(
      parseEngineExecutionRequest({
        requestId: "run-memory-123",
        target: { type: "workflow", id: "learn-from-runs" },
        intent: "run",
        source: "dashboard",
        input: { runId: "run-memory-123" },
      }),
    ).toEqual({
      request: {
        requestId: "run-memory-123",
        target: { type: "workflow", id: "learn-from-runs" },
        intent: "run",
        source: "dashboard",
        input: { runId: "run-memory-123" },
      },
    });
  });

  it("treats Loop as a first-class execution target", () => {
    expect(
      parseEngineExecutionRequest({
        requestId: "loop-request-1",
        target: { type: "loop", id: "maintain-memory-quality" },
        intent: "run",
        source: "dashboard",
      }),
    ).toEqual({
      request: {
        requestId: "loop-request-1",
        target: { type: "loop", id: "maintain-memory-quality" },
        intent: "run",
        source: "dashboard",
      },
    });
  });

  it("treats Goal as a first-class execution target", () => {
    expect(
      parseEngineExecutionRequest({
        requestId: "goal-request-1",
        target: { type: "goal", id: "ship-release" },
        intent: "manage",
        source: "schedule",
      }),
    ).toMatchObject({ request: { target: { type: "goal", id: "ship-release" } } });
  });

  it.each([
    [{ target: { type: "workflow", id: "learn" }, intent: "run", source: "dashboard" }, "requestId"],
    [
      {
        requestId: "request-1",
        target: { type: "machine", id: "m1" },
        intent: "run",
        source: "dashboard",
      },
      "target.type",
    ],
    [
      {
        requestId: "request-1",
        target: { type: "workflow", id: "learn" },
        intent: "run",
        source: "dashboard",
        input: [],
      },
      "input",
    ],
    [
      {
        requestId: "bad request",
        target: { type: "workflow", id: "learn" },
        intent: "run",
        source: "dashboard",
      },
      "requestId",
    ],
  ])("rejects malformed requests", (value, message) => {
    expect(parseEngineExecutionRequest(value)).toEqual({
      error: expect.stringContaining(message),
    });
  });
});
