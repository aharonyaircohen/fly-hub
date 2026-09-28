import type {
  GuidedFlowFrame,
  GuidedFlowInstance,
  GuidedFlowStatus,
} from "./controller";

export interface GuidedFlowStoredFrame {
  flowId: string;
  flowVersion: number;
  currentStepId: string;
  data: unknown;
  history: string[];
}

export interface GuidedFlowStoredInstance {
  instanceId: string;
  instanceKey?: string;
  flowId: string;
  flowVersion: number;
  currentStepId: string;
  status: GuidedFlowStatus;
  revision: number;
  data: unknown;
  output?: unknown;
  history: string[];
  stack?: GuidedFlowStoredFrame[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function frameFromStored(frame: GuidedFlowStoredFrame): GuidedFlowFrame {
  return {
    flowId: frame.flowId,
    flowVersion: frame.flowVersion,
    currentStepId: frame.currentStepId,
    data: record(frame.data),
    backStack: frame.history,
  };
}

export function guidedFlowInstanceFromRow(
  row: GuidedFlowStoredInstance,
): GuidedFlowInstance {
  return {
    instanceId: row.instanceId,
    ...(row.instanceKey ? { instanceKey: row.instanceKey } : {}),
    flowId: row.flowId,
    flowVersion: row.flowVersion,
    currentStepId: row.currentStepId,
    status: row.status,
    revision: row.revision,
    data: record(row.data),
    output: record(row.output),
    backStack: row.history,
    stack: (row.stack ?? []).map(frameFromStored),
  };
}

export function guidedFlowInstanceWriteFields(
  instance: GuidedFlowInstance,
): GuidedFlowStoredInstance & {
  output: Record<string, unknown>;
  stack: GuidedFlowStoredFrame[];
} {
  return {
    instanceId: instance.instanceId,
    ...(instance.instanceKey ? { instanceKey: instance.instanceKey } : {}),
    flowId: instance.flowId,
    flowVersion: instance.flowVersion,
    currentStepId: instance.currentStepId,
    status: instance.status,
    revision: instance.revision,
    data: instance.data,
    output: instance.output,
    history: [...instance.backStack],
    stack: instance.stack.map((frame) => ({
      flowId: frame.flowId,
      flowVersion: frame.flowVersion,
      currentStepId: frame.currentStepId,
      data: frame.data,
      history: [...frame.backStack],
    })),
  };
}
