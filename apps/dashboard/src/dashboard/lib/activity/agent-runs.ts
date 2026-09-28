export type AgentCallOutcome = "success" | "rejected" | "error";

export type AgentMcpCall = {
  eventId: string;
  method: string;
  toolName?: string;
  actionId?: string;
  outcome: AgentCallOutcome;
  occurredAt: string;
};

export type AgentApproval = {
  requestId: string;
  workRecordId: string;
  targetKind: "workflow" | "capability" | "automation";
  workflowId: string;
  executionRunId: string;
  mode: "start" | "resume";
  status:
    "pending" | "approving" | "rejected" | "dispatched" | "failed" | "expired";
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  execution?: {
    status: "running" | "waiting-approval" | "blocked" | "failed" | "done";
    updatedAt: string;
    url?: string;
  };
};

export type AgentRun = {
  runId: string;
  agentName: string;
  clientName?: string;
  repository: string;
  workRecordId?: string;
  workTitle?: string;
  startedAt: string;
  lastActivityAt: string;
  endedAt?: string;
  status: "running" | "completed" | "failed";
  summary: string;
  result: string;
  callCount: number;
  evidence: Array<{
    kind: string;
    reference: string;
    summary: string;
    recordedAt: string;
  }>;
  handoff?: {
    toAgent: string;
    summary: string;
    nextSteps: string[];
    recordedAt: string;
  };
  approvals: AgentApproval[];
  calls: AgentMcpCall[];
};

export type AgentRunsPayload = {
  runs: AgentRun[];
  computedAt: string;
};
