import type { EngineExecutionRequest } from "@kody-ade/engine-contracts";

export interface KodyStoreTarget {
  storeRepoUrl?: string;
  storeRef?: string;
}

export function chatExecutionRequest(
  requestId: string,
  sessionId: string,
): EngineExecutionRequest {
  return {
    requestId,
    target: { type: "chat", id: sessionId },
    intent: "continue",
    source: "dashboard",
  };
}

export function issueExecutionRequest(
  requestId: string,
  issueNumber: number,
): EngineExecutionRequest {
  return {
    requestId,
    target: { type: "issue", id: issueNumber },
    intent: "run",
    source: "dashboard",
  };
}

export function withStoreTarget(
  request: EngineExecutionRequest,
  target: KodyStoreTarget | null | undefined,
): EngineExecutionRequest {
  const storeRepoUrl = target?.storeRepoUrl?.trim();
  const storeRef = target?.storeRef?.trim();
  if (!storeRepoUrl && !storeRef) return request;

  return {
    ...request,
    input: {
      ...(request.input ?? {}),
      ...(storeRepoUrl ? { storeRepoUrl } : {}),
      ...(storeRef ? { storeRef } : {}),
    },
  };
}
