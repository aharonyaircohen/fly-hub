import { describe, expect, it } from "vitest";
import {
  guidedFlowChatReducer,
  initialGuidedFlowChatState,
  isGuidedFlowOpenRequest,
} from "../../src/dashboard/lib/guided-flows/chat-controller";

describe("GuidedFlow open requests", () => {
  it("accepts a definition start request", () => {
    expect(
      isGuidedFlowOpenRequest({
        flowId: "record",
        instanceKey: "student-1",
        message: "started",
      }),
    ).toBe(true);
  });

  it("accepts the definition source scope used to start the flow", () => {
    expect(
      isGuidedFlowOpenRequest({
        flowId: "record",
        message: "started",
        sourceScope: { kind: "user" },
      }),
    ).toBe(true);
    expect(
      isGuidedFlowOpenRequest({
        flowId: "record",
        message: "started",
        sourceScope: { kind: "repository", owner: "acme", repo: "widgets" },
      }),
    ).toBe(true);
  });

  it("rejects a malformed definition source scope", () => {
    expect(
      isGuidedFlowOpenRequest({
        flowId: "record",
        message: "started",
        sourceScope: { kind: "repository", owner: "acme" },
      }),
    ).toBe(false);
  });

  it("accepts an exact instance resume request", () => {
    expect(
      isGuidedFlowOpenRequest({
        instanceId: "instance-1",
        message: "resumed",
      }),
    ).toBe(true);
  });

  it("rejects incomplete requests", () => {
    expect(isGuidedFlowOpenRequest({ message: "started" })).toBe(false);
  });

  it("keeps one explicit request until its owner acknowledges it", () => {
    const requested = guidedFlowChatReducer(initialGuidedFlowChatState, {
      type: "request",
      requestId: "request-1",
      request: {
        instanceId: "instance-1",
        message: "resumed",
      },
    });

    expect(
      requested.pending && "instanceId" in requested.pending.request
        ? requested.pending.request.instanceId
        : null,
    ).toBe("instance-1");
    expect(
      guidedFlowChatReducer(requested, {
        type: "acknowledge",
        requestId: "not-the-owner",
      }),
    ).toBe(requested);
    expect(
      guidedFlowChatReducer(requested, {
        type: "acknowledge",
        requestId: requested.pending?.id ?? "",
      }),
    ).toEqual(initialGuidedFlowChatState);
  });

  it("marks a request that must wait for the full Chat route", () => {
    expect(
      guidedFlowChatReducer(initialGuidedFlowChatState, {
        type: "request",
        requestId: "request-1",
        destination: "chat",
        request: {
          flowId: "initialize-kody-engine",
          message: "started",
        },
      }).pending,
    ).toMatchObject({
      destination: "chat",
      request: { flowId: "initialize-kody-engine" },
    });
  });
});
