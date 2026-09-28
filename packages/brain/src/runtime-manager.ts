/**
 * @fileType service
 * @domain brain
 * @pattern brain-runtime-manager
 *
 * Owns Brain desired/running state transitions. API routes and terminal
 * session code should depend on this layer instead of reading image catalog
 * internals.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { readBrainImage, readBrainImageSave } from "./store";
import {
  readBrainRuntimeState,
  writeBrainRuntimeState,
  type BrainRuntimeOperation,
  type BrainRuntimeRunning,
  type BrainRuntimeStage,
  type BrainRuntimeStateFile,
} from "./runtime-store";

const beginLocks = new Map<string, Promise<void>>();
const STALE_SAVE_OPERATION_MS = 15 * 60_000;
const STALE_ORPHAN_OPERATION_MS = 15 * 60_000;
const STALE_APPLY_OPERATION_MS = 15 * 60_000;

function operationAgeMs(operation: BrainRuntimeOperation): number {
  const updatedAt = Date.parse(operation.updatedAt);
  return Number.isFinite(updatedAt) ? Date.now() - updatedAt : Infinity;
}

async function withBeginLock<T>(
  login: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = beginLocks.get(login) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  beginLocks.set(login, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (beginLocks.get(login) === queued) beginLocks.delete(login);
  }
}

export interface BrainRuntimeView {
  desiredImageRef?: string;
  runningImageRef?: string;
  runningAt?: string;
  runningApp?: string;
  runningMachineId?: string;
  runningOrgSlug?: string;
  runningUrl?: string;
  operation?: BrainRuntimeOperation;
  source: "runtime" | "legacy" | "empty";
}

export async function readBrainRuntimeView(
  login: string,
  token: string,
): Promise<BrainRuntimeView> {
  const runtime = await readBrainRuntimeState(login, token, true);
  if (runtime?.running) {
    return viewFromRuntime(runtime);
  }
  const legacyImage = await readBrainImage(login, token).catch(() => null);
  if (legacyImage?.runningImageRef) {
    return {
      desiredImageRef: runtime?.desiredImageRef ?? legacyImage.imageRef,
      runningImageRef: legacyImage.runningImageRef,
      runningAt: legacyImage.runningAt,
      runningApp: legacyImage.runningApp,
      runningMachineId: legacyImage.runningMachineId,
      operation: runtime?.operation,
      source: "legacy",
    };
  }
  return {
    desiredImageRef: runtime?.desiredImageRef ?? legacyImage?.imageRef,
    operation: runtime?.operation,
    source: runtime ? "runtime" : "empty",
  };
}

/**
 * Clear the deployed Fly runtime after Brain is turned off while preserving
 * the desired image selection for a future apply.
 */
export async function clearBrainRuntimeDeployment(
  login: string,
  token: string,
): Promise<void> {
  const current = await readBrainRuntimeState(login, token, true);
  if (!current?.running && !current?.operation) return;
  await writeBrainRuntimeState(login, token, {
    version: 1,
    ...(current.desiredImageRef
      ? { desiredImageRef: current.desiredImageRef }
      : {}),
    updatedAt: new Date().toISOString(),
  });
}

function viewFromRuntime(runtime: BrainRuntimeStateFile): BrainRuntimeView {
  const running = runtime.running;
  return {
    desiredImageRef: runtime.desiredImageRef,
    ...(running
      ? {
          runningImageRef: running.imageRef,
          runningAt: running.appliedAt,
          runningApp: running.app,
          runningMachineId: running.machineId,
          runningOrgSlug: running.orgSlug,
          runningUrl: running.url,
        }
      : {}),
    operation: runtime.operation,
    source: "runtime",
  };
}

export async function beginBrainRuntimeApply(
  login: string,
  token: string,
  imageRef: string,
  type: BrainRuntimeOperation["type"] = "apply-image",
): Promise<BrainRuntimeStateFile> {
  return await withBeginLock(login, async () => {
    let current = await readBrainRuntimeState(login, token, true);
    const now = new Date(
      Math.max(Date.now(), (Date.parse(current?.updatedAt ?? "") || 0) + 1),
    ).toISOString();
    let staleSave = false;
    let staleOrphan = false;
    let staleApply = false;
    if (current?.operation?.status === "running") {
      const save =
        current.operation.type === "save-image"
          ? await readBrainImageSave(login, token).catch(() => null)
          : null;
      staleSave =
        current.operation.type === "save-image" &&
        save?.jobId !== current.operation.id &&
        Date.now() - Date.parse(current.operation.updatedAt) >
          STALE_SAVE_OPERATION_MS;
      staleOrphan =
        !current.running &&
        operationAgeMs(current.operation) > STALE_ORPHAN_OPERATION_MS;
      staleApply =
        current.operation.type === "apply-image" &&
        operationAgeMs(current.operation) > STALE_APPLY_OPERATION_MS;
      if (staleSave || staleOrphan || staleApply) {
        // A completed worker can outlive the status writer. A missing save
        // record means the old save no longer owns the Brain operation.
      } else {
      throw Object.assign(
        new Error(
          "Another Brain operation is still running. Wait for it to finish.",
        ),
        { status: 409, code: "brain_operation_conflict" },
      );
      }
    }
    const operation: BrainRuntimeOperation = {
      id: randomUUID().replaceAll("-", ""),
      type,
      status: "running",
      imageRef,
      startedAt: now,
      updatedAt: now,
      ...(type === "apply-image" ? { stage: "validating" as const, attempt: 1 } : {}),
    };
    const next: BrainRuntimeStateFile = {
      version: 1,
      ...(type === "apply-image"
        ? { desiredImageRef: imageRef }
        : current?.desiredImageRef
          ? { desiredImageRef: current.desiredImageRef }
          : {}),
      ...(current?.running ? { running: current.running } : {}),
      operation,
      updatedAt: now,
    };
    try {
      await writeBrainRuntimeState(
        login,
        token,
        next,
        current && !staleSave && !staleOrphan && !staleApply
          ? current.updatedAt
          : undefined,
      );
    } catch (error) {
      // A separate worker may have advanced the Convex revision between the
      // read and compare-and-save. Re-read once and reclaim only when the
      // competing operation is no longer active; a live operation remains a
      // real conflict for the caller.
      current = await readBrainRuntimeState(login, token, true);
      const competing = current?.operation;
      const active = competing?.status === "running";
      const save =
        active && competing.type === "save-image"
          ? await readBrainImageSave(login, token).catch(() => null)
          : null;
      const recoverable =
        !active ||
        (!current?.running &&
          competing &&
          operationAgeMs(competing) > STALE_ORPHAN_OPERATION_MS) ||
        (competing?.type === "apply-image" &&
          operationAgeMs(competing) > STALE_APPLY_OPERATION_MS) ||
        (competing?.type === "save-image" &&
          save?.jobId !== competing.id &&
          Date.now() - Date.parse(competing.updatedAt) >
            STALE_SAVE_OPERATION_MS);
      if (!recoverable) throw error;
      await writeBrainRuntimeState(login, token, next);
    }
    return next;
  });
}

export async function resumeBrainRuntimeApply(
  login: string,
  token: string,
  operationId: string,
  imageRef: string,
): Promise<BrainRuntimeStateFile> {
  let current = await readBrainRuntimeState(login, token, true);
  for (let writeAttempt = 0; writeAttempt < 2; writeAttempt += 1) {
    if (
      current?.operation?.id !== operationId ||
      current.operation.type !== "apply-image" ||
      current.operation.imageRef !== imageRef ||
      current.operation.status === "completed"
    ) {
      throw Object.assign(new Error("Brain restore job is no longer current"), {
        status: 409,
        code: "brain_operation_conflict",
      });
    }
    if (current.operation.status === "running") return current;
    const now = nextTimestamp(current.updatedAt);
    const { error: _error, recoveredImageRef: _recovered, ...operation } =
      current.operation;
    const next: BrainRuntimeStateFile = {
      ...current,
      operation: {
        ...operation,
        status: "running",
        stage: "validating",
        attempt: (current.operation.attempt ?? 1) + 1,
        updatedAt: now,
      },
      updatedAt: now,
    };
    try {
      await writeBrainRuntimeState(login, token, next, current.updatedAt);
      return next;
    } catch (error) {
      if (writeAttempt > 0) throw error;
      current = await readBrainRuntimeState(login, token, true);
    }
  }
  throw new Error("Brain restore operation could not be resumed");
}

export async function setBrainRuntimeApplyStage(
  login: string,
  token: string,
  operationId: string,
  imageRef: string,
  stage: BrainRuntimeStage,
): Promise<BrainRuntimeStateFile> {
  let current = await readBrainRuntimeState(login, token, true);
  assertActiveOperation(current, operationId, imageRef);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const now = nextTimestamp(current!.updatedAt);
    const next: BrainRuntimeStateFile = {
      ...current!,
      operation: { ...current!.operation!, stage, updatedAt: now },
      updatedAt: now,
    };
    try {
      await writeBrainRuntimeState(login, token, next, current!.updatedAt);
      return next;
    } catch (error) {
      if (attempt > 0) throw error;
      current = await readBrainRuntimeState(login, token, true);
      assertActiveOperation(current, operationId, imageRef);
    }
  }
  throw new Error("Brain runtime stage could not be recorded");
}

export async function completeBrainRuntimeApply(
  login: string,
  token: string,
  input: {
    operationId: string;
    imageRef: string;
    app: string;
    machineId: string;
    orgSlug: string;
    url?: string;
    appliedAt?: string;
  },
): Promise<BrainRuntimeStateFile> {
  const now = input.appliedAt ?? new Date().toISOString();
  const current = await readBrainRuntimeState(login, token, true);
  assertActiveOperation(current, input.operationId, input.imageRef);
  const running: BrainRuntimeRunning = {
    imageRef: input.imageRef,
    app: input.app,
    machineId: input.machineId,
    orgSlug: input.orgSlug,
    ...(input.url ? { url: input.url } : {}),
    appliedAt: now,
  };
  const operation: BrainRuntimeOperation = {
    id: current?.operation?.id ?? randomUUID().replaceAll("-", ""),
    type: "apply-image",
    status: "completed",
    imageRef: input.imageRef,
    startedAt: current?.operation?.startedAt ?? now,
    updatedAt: now,
    ...(current?.operation?.stage ? { stage: current.operation.stage } : {}),
    ...(current?.operation?.attempt ? { attempt: current.operation.attempt } : {}),
  };
  const next: BrainRuntimeStateFile = {
    version: 1,
    desiredImageRef: input.imageRef,
    running,
    operation,
    updatedAt: now,
  };
  try {
    await writeBrainRuntimeState(
      login,
      token,
      next,
      current?.updatedAt ?? null,
    );
  } catch (error) {
    const latest = await readBrainRuntimeState(login, token, true);
    assertActiveOperation(latest, input.operationId, input.imageRef);
    await writeBrainRuntimeState(login, token, next);
  }
  return next;
}

export async function failBrainRuntimeApply(
  login: string,
  token: string,
  imageRef: string,
  error: string,
  operationId: string,
  recoveredRunning?: BrainRuntimeRunning,
): Promise<void> {
  const current = await readBrainRuntimeState(login, token, true);
  const now = new Date(
    Math.max(Date.now(), (Date.parse(current?.updatedAt ?? "") || 0) + 1),
  ).toISOString();
  assertActiveOperation(current, operationId, imageRef);
  const operation: BrainRuntimeOperation = {
    id: current?.operation?.id ?? randomUUID().replaceAll("-", ""),
    type: "apply-image",
    status: "failed",
    imageRef,
    startedAt: current?.operation?.startedAt ?? now,
    updatedAt: now,
    ...(current?.operation?.stage ? { stage: current.operation.stage } : {}),
    ...(current?.operation?.attempt ? { attempt: current.operation.attempt } : {}),
    error,
    ...(recoveredRunning
      ? { recoveredImageRef: recoveredRunning.imageRef }
      : {}),
  };
  const next: BrainRuntimeStateFile = {
    version: 1,
    desiredImageRef: imageRef,
    ...(recoveredRunning
      ? { running: recoveredRunning }
      : current?.running
        ? { running: current.running }
        : {}),
    operation,
    updatedAt: now,
  };
  try {
    await writeBrainRuntimeState(login, token, next, current?.updatedAt ?? null);
  } catch (error) {
    const latest = await readBrainRuntimeState(login, token, true);
    assertActiveOperation(latest, operationId, imageRef);
    await writeBrainRuntimeState(login, token, next);
  }
}

function nextTimestamp(previous: string): string {
  return new Date(
    Math.max(Date.now(), (Date.parse(previous) || 0) + 1),
  ).toISOString();
}

function assertActiveOperation(
  current: BrainRuntimeStateFile | null,
  id: string,
  imageRef: string,
): void {
  if (
    !id ||
    current?.operation?.id !== id ||
    current.operation.status !== "running" ||
    current.operation.imageRef !== imageRef
  ) {
    throw Object.assign(new Error("Brain operation is no longer current"), {
      status: 409,
      code: "brain_operation_conflict",
    });
  }
}

export async function finishBrainImageSaveOperation(
  login: string,
  token: string,
  operationId: string,
  error?: string,
): Promise<void> {
  const current = await readBrainRuntimeState(login, token, true);
  // Legacy saves predate operation ownership. Never overwrite a newer operation.
  if (
    current?.operation?.type !== "save-image" ||
    current.operation.id !== operationId ||
    current.operation.status !== "running"
  )
    return;
  const completedState = (state: BrainRuntimeStateFile) => {
    const now = new Date(
      Math.max(Date.now(), (Date.parse(state.updatedAt) || 0) + 1),
    ).toISOString();
    return {
      ...state,
      updatedAt: now,
      operation: {
        ...state.operation!,
        status: error ? ("failed" as const) : ("completed" as const),
        updatedAt: now,
        ...(error ? { error } : {}),
      },
    };
  };
  try {
    await writeBrainRuntimeState(
      login,
      token,
      completedState(current),
      current.updatedAt,
    );
  } catch {
    const latest = await readBrainRuntimeState(login, token, true);
    if (
      latest?.operation?.type !== "save-image" ||
      latest.operation.id !== operationId ||
      latest.operation.status !== "running"
    )
      return;
    await writeBrainRuntimeState(login, token, completedState(latest));
  }
}
