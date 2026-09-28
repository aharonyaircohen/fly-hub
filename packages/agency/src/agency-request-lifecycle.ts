import {
  createAgencyRequestState,
  type AgencyRequestExecution,
  type AgencyRequestState,
} from "@kody-ade/agency-domain";

export interface AgencyRequestRecord {
  slug: string;
  state: AgencyRequestState;
}

interface StartPorts {
  read(slug: string): Promise<AgencyRequestRecord | null>;
  save(slug: string, state: AgencyRequestState): Promise<void>;
  prepare(execution: AgencyRequestExecution): Promise<AgencyRequestExecution>;
  createRunId(): string;
  dispatch(
    execution: AgencyRequestExecution,
    runId: string,
  ): Promise<{ runId: string }>;
}

interface CompletionPorts {
  findByRun(runId: string, loopId?: string): Promise<AgencyRequestRecord[]>;
  verify?(
    record: AgencyRequestRecord,
    input: CompletionInput,
  ): Promise<{ passed: boolean; evidence: string }>;
  save(slug: string, state: AgencyRequestState): Promise<void>;
}

type CompletionInput = {
  workflowId: string;
  runId: string;
  loopId?: string;
  status: "success" | "failed" | "blocked";
  summary?: string;
};

export function agencyRequestLoopId(slug: string): string {
  return `agency-request-${slug}`;
}

function normalizedFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.trim() || "Workflow dispatch failed").slice(0, 2_000);
}

function withState(
  state: AgencyRequestState,
  patch: Partial<AgencyRequestState>,
): AgencyRequestState {
  return createAgencyRequestState({ ...state, ...patch });
}

export async function startAgencyRequest(slug: string, ports: StartPorts) {
  const record = await ports.read(slug);
  if (!record) return { kind: "not-found" as const };
  const existingRun = record.state.related.find((ref) => ref.kind === "run");
  if (
    existingRun &&
    (record.state.phase === "running" ||
      record.state.phase === "monitoring" ||
      record.state.phase === "done")
  ) {
    return { kind: "existing" as const, runId: existingRun.id };
  }
  if (record.state.phase !== "waiting-approval") {
    return { kind: "invalid-phase" as const, phase: record.state.phase };
  }
  if (!record.state.execution) {
    const message = "The approved plan has no executable Workflow target.";
    await ports.save(
      slug,
      withState(record.state, { phase: "blocked", blockers: [message] }),
    );
    return { kind: "blocked" as const, message };
  }

  let execution: AgencyRequestExecution;
  try {
    execution = await ports.prepare(record.state.execution);
  } catch (error) {
    const message = normalizedFailure(error);
    await ports.save(
      slug,
      withState(record.state, { phase: "blocked", blockers: [message] }),
    );
    throw error;
  }

  const reservedRunId = ports.createRunId();
  const loopId = agencyRequestLoopId(slug);
  const monitoringState = withState(record.state, {
    phase: "monitoring",
    execution,
    blockers: [],
    related: [
      ...record.state.related.filter(
        (ref) =>
          !(
            (ref.kind === "run" && ref.id === reservedRunId) ||
            (ref.kind === "loop" && ref.id === loopId)
          ),
      ),
      { kind: "loop", id: loopId },
      { kind: "run", id: reservedRunId },
    ],
  });
  await ports.save(slug, monitoringState);
  try {
    const result = await ports.dispatch(execution, reservedRunId);
    if (result.runId !== reservedRunId) {
      throw new Error("Workflow dispatch returned a different Run id");
    }
    return { kind: "started" as const, runId: result.runId };
  } catch (error) {
    const message = normalizedFailure(error);
    await ports.save(
      slug,
      withState(monitoringState, {
        phase: "blocked",
        evidence: [
          ...monitoringState.evidence,
          `Workflow dispatch ${reservedRunId} failed: ${message}`,
        ],
        blockers: [message],
      }),
    );
    throw error;
  }
}

export async function completeAgencyRequestRun(
  input: CompletionInput,
  ports: CompletionPorts,
): Promise<{ updated: number }> {
  const records = await ports.findByRun(input.runId, input.loopId);
  const summary = input.summary?.trim().slice(0, 2_000);
  let updated = 0;
  for (const record of records) {
    if (record.state.phase === "done") continue;
    const workflowSucceeded = input.status === "success";
    const verification = workflowSucceeded
      ? await ports.verify?.(record, input) ?? {
          passed: false,
          evidence: "No end-to-end verification was performed.",
        }
      : null;
    const succeeded = workflowSucceeded && verification?.passed === true;
    const result = `Workflow ${input.workflowId} run ${input.runId} ${
      workflowSucceeded ? "succeeded" : input.status
    }${summary ? `: ${summary}` : "."}`;
    const verificationResult =
      verification && !verification.passed
        ? `Success criteria not met: ${verification.evidence}`
        : null;
    const loopId = agencyRequestLoopId(record.slug);
    const related = record.state.related
      .filter((ref) => !(succeeded && ref.kind === "loop" && ref.id === loopId))
      .filter((ref) => !(ref.kind === "run" && ref.id === input.runId));
    related.push({ kind: "run", id: input.runId });
    await ports.save(
      record.slug,
      withState(record.state, {
        phase: succeeded ? "done" : "monitoring",
        evidence: [
          ...record.state.evidence,
          result,
          ...(verification?.passed
            ? [`Verified success criteria: ${verification.evidence}`]
            : []),
        ],
        blockers: succeeded
          ? []
          : [verificationResult ?? result],
        related,
      }),
    );
    updated += 1;
  }
  return { updated };
}
