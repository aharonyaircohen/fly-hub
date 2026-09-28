export type WorkflowRunStatus =
  | "running"
  | "waiting-approval"
  | "blocked"
  | "failed"
  | "done";

export interface WorkflowRunApproval {
  stepId: string;
  action: string;
  contextHash: string;
  status: "pending" | "approved" | "consumed";
  approvedAt?: string;
  approvedBy?: string;
}

export interface WorkflowRunStepState {
  capability?: string;
  status: "running" | "completed" | "blocked" | "failed";
  input?: unknown;
  output?: unknown;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowRunState {
  status: WorkflowRunStatus;
  currentStepId?: string;
  completedStepIds: string[];
  transitionCounts: Record<string, number>;
  facts: Record<string, unknown>;
  evidence: Record<string, boolean>;
  artifacts: Array<{ label: string; url?: string; path?: string }>;
  steps: Record<string, WorkflowRunStepState>;
  blocker?: string;
  approval?: WorkflowRunApproval;
}

export interface WorkflowRunStateRecord {
  workflowId: string;
  runId: string;
  state: WorkflowRunState;
}

export function latestWorkflowRunDocument<
  T extends { runId: string; updatedAt?: string; _creationTime?: number },
>(docs: readonly T[]): T | undefined {
  return [...docs].sort((left, right) => {
    const leftTime = left.updatedAt
      ? Date.parse(left.updatedAt)
      : (left._creationTime ?? 0);
    const rightTime = right.updatedAt
      ? Date.parse(right.updatedAt)
      : (right._creationTime ?? 0);
    return leftTime - rightTime || left.runId.localeCompare(right.runId);
  }).at(-1);
}

export function normalizeWorkflowRunState(
  raw: unknown,
): WorkflowRunState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    value.status !== "running" &&
    value.status !== "waiting-approval" &&
    value.status !== "blocked" &&
    value.status !== "failed" &&
    value.status !== "done"
  )
    return null;

  const completedStepIds = Array.isArray(value.completedStepIds)
    ? value.completedStepIds.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const transitionCounts =
    value.transitionCounts &&
    typeof value.transitionCounts === "object" &&
    !Array.isArray(value.transitionCounts)
      ? Object.fromEntries(
          Object.entries(value.transitionCounts).filter(
            (entry): entry is [string, number] =>
              Number.isInteger(entry[1]) && (entry[1] as number) >= 0,
          ),
        )
      : {};
  const facts =
    value.facts &&
    typeof value.facts === "object" &&
    !Array.isArray(value.facts)
      ? { ...(value.facts as Record<string, unknown>) }
      : {};
  const evidence =
    value.evidence &&
    typeof value.evidence === "object" &&
    !Array.isArray(value.evidence)
      ? Object.fromEntries(
          Object.entries(value.evidence).filter(
            (entry): entry is [string, boolean] =>
              typeof entry[1] === "boolean",
          ),
        )
      : {};
  const artifacts = Array.isArray(value.artifacts)
    ? value.artifacts.filter(
        (item): item is { label: string; url?: string; path?: string } =>
          !!item &&
          typeof item === "object" &&
          typeof (item as { label?: unknown }).label === "string" &&
          ((item as { url?: unknown }).url === undefined ||
            typeof (item as { url?: unknown }).url === "string") &&
          ((item as { path?: unknown }).path === undefined ||
            typeof (item as { path?: unknown }).path === "string"),
      )
    : [];
  const steps = normalizeWorkflowRunSteps(value.steps);
  const approval = normalizeWorkflowRunApproval(value.approval);

  return {
    status: value.status,
    ...(typeof value.currentStepId === "string"
      ? { currentStepId: value.currentStepId }
      : {}),
    completedStepIds,
    transitionCounts,
    facts,
    evidence,
    artifacts: artifacts.map((artifact) => ({ ...artifact })),
    steps,
    ...(typeof value.blocker === "string" ? { blocker: value.blocker } : {}),
    ...(approval ? { approval } : {}),
  };
}

function normalizeWorkflowRunApproval(raw: unknown): WorkflowRunApproval | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.stepId !== "string" ||
    typeof value.action !== "string" ||
    typeof value.contextHash !== "string" ||
    (value.status !== "pending" &&
      value.status !== "approved" &&
      value.status !== "consumed") ||
    (value.approvedAt !== undefined && typeof value.approvedAt !== "string") ||
    (value.approvedBy !== undefined && typeof value.approvedBy !== "string")
  ) {
    return null;
  }
  return {
    stepId: value.stepId,
    action: value.action,
    contextHash: value.contextHash,
    status: value.status,
    ...(typeof value.approvedAt === "string"
      ? { approvedAt: value.approvedAt }
      : {}),
    ...(typeof value.approvedBy === "string"
      ? { approvedBy: value.approvedBy }
      : {}),
  };
}

function normalizeWorkflowRunSteps(
  raw: unknown,
): Record<string, WorkflowRunStepState> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).flatMap(([id, candidate]) => {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      )
        return [];
      const value = candidate as Record<string, unknown>;
      if (
        (value.capability !== undefined &&
          typeof value.capability !== "string") ||
        (value.status !== "running" &&
          value.status !== "completed" &&
          value.status !== "blocked" &&
          value.status !== "failed") ||
        (value.startedAt !== undefined &&
          typeof value.startedAt !== "string") ||
        (value.completedAt !== undefined &&
          typeof value.completedAt !== "string")
      )
        return [];
      return [
        [
          id,
          {
            ...(typeof value.capability === "string"
              ? { capability: value.capability }
              : {}),
            status: value.status,
            ...(Object.prototype.hasOwnProperty.call(value, "input")
              ? { input: value.input }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(value, "output")
              ? { output: value.output }
              : {}),
            ...(typeof value.startedAt === "string"
              ? { startedAt: value.startedAt }
              : {}),
            ...(typeof value.completedAt === "string"
              ? { completedAt: value.completedAt }
              : {}),
          } satisfies WorkflowRunStepState,
        ],
      ];
    }),
  );
}
