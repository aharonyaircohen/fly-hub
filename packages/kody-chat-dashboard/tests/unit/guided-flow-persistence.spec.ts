import { describe, expect, it } from "vitest";

import {
  guidedFlowInstanceFromRow,
  guidedFlowInstanceWriteFields,
} from "../../src/dashboard/lib/guided-flows/persistence";

describe("guided flow persistence mapping", () => {
  it("maps a stored row into a safe runtime instance", () => {
    expect(
      guidedFlowInstanceFromRow({
        instanceId: "instance-1",
        flowId: "child",
        flowVersion: 2,
        currentStepId: "answer",
        status: "active",
        revision: 3,
        data: "invalid",
        output: { answer: "four" },
        history: [],
        stack: [
          {
            flowId: "parent",
            flowVersion: 1,
            currentStepId: "task",
            data: null,
            history: ["intro"],
          },
        ],
      }),
    ).toEqual({
      instanceId: "instance-1",
      flowId: "child",
      flowVersion: 2,
      currentStepId: "answer",
      status: "active",
      revision: 3,
      data: {},
      output: { answer: "four" },
      backStack: [],
      stack: [
        {
          flowId: "parent",
          flowVersion: 1,
          currentStepId: "task",
          data: {},
          backStack: ["intro"],
        },
      ],
    });
  });

  it("creates one persistence payload for every transport", () => {
    const instance = guidedFlowInstanceFromRow({
      instanceId: "instance-1",
      instanceKey: "record",
      flowId: "child",
      flowVersion: 2,
      currentStepId: "answer",
      status: "active",
      revision: 3,
      data: { attempt: 1 },
      output: {},
      history: [],
      stack: [],
    });

    expect(guidedFlowInstanceWriteFields(instance)).toEqual({
      instanceId: "instance-1",
      instanceKey: "record",
      flowId: "child",
      flowVersion: 2,
      currentStepId: "answer",
      status: "active",
      revision: 3,
      data: { attempt: 1 },
      output: {},
      history: [],
      stack: [],
    });
  });
});
