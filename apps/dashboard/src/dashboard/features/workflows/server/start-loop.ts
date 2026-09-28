import type {
  EngineExecutionReceipt,
  EngineExecutionRequest,
  EngineExecutionSource,
} from "@kody-ade/engine-contracts";
import type { LoopDefinition } from "@kody-ade/agency-domain";

export interface LoopExecutionDependencies {
  createRequestId(): string;
  loadLoop(loopId: string): Promise<LoopDefinition | null>;
  authorize(
    loopId: string,
    loop: LoopDefinition,
    explicitlyApproved: boolean,
  ): Promise<boolean>;
  dispatch(request: EngineExecutionRequest): Promise<EngineExecutionReceipt>;
}

export interface StartLoopCommand {
  loopId: string;
  source: EngineExecutionSource;
  approved?: boolean;
}

export type StartLoopResult =
  | {
      kind: "accepted";
      loopId: string;
      requestId: string;
      acceptedAt: string;
    }
  | { kind: "not-found" }
  | { kind: "disabled" }
  | { kind: "approval-required" };

export async function startLoop(
  command: StartLoopCommand,
  dependencies: LoopExecutionDependencies,
): Promise<StartLoopResult> {
  const loop = await dependencies.loadLoop(command.loopId);
  if (!loop) return { kind: "not-found" };
  if (!loop.enabled) return { kind: "disabled" };
  if (
    !(await dependencies.authorize(
      command.loopId,
      loop,
      command.approved === true,
    ))
  ) {
    return { kind: "approval-required" };
  }

  const requestId = dependencies.createRequestId();
  const receipt = await dependencies.dispatch({
    requestId,
    target: { type: "loop", id: command.loopId },
    intent: "run",
    source: command.source,
  });
  return {
    kind: "accepted",
    loopId: command.loopId,
    requestId: receipt.requestId,
    acceptedAt: receipt.acceptedAt,
  };
}
