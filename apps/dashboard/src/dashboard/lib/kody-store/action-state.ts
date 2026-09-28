/**
 * @fileOverview Kody Action State Store — Convex-backed
 * @fileType store
 * @domain kody
 *
 * Stores action polling state in the global (cross-tenant) Convex
 * `actionStates` table via actionStates.{get,save,list,remove}.
 * Replaces the GitHub-backed `action-state.json` in the Kody backend
 * (which itself replaced a local-FS store that didn't survive Vercel
 * serverless cold starts).
 *
 * The `opts` bags (owner/repo/branch/octokit) are retained for signature
 * compatibility with the backend era; Convex ignores them — the table is
 * global and keyed by runId.
 */

import type { Octokit } from "@octokit/rest";
import { backendApi, getConvexClient } from "../backend/convex-backend";

export type ActionStatus = "running" | "waiting" | "complete" | "cancelled";

export interface ActionState {
  runId: string;
  actionId: string;
  sessionId?: string;
  taskId?: string;
  status: ActionStatus;
  step: string;
  instructions: string[];
  cancel: boolean;
  cancelledBy?: string;
  lastHeartbeat: string;
  createdAt: string;
}

/** Legacy opts bag — unused by the Convex store, kept so callers compile. */
export interface ActionStateOpts {
  owner?: string;
  repo?: string;
  branch?: string;
  octokit?: Octokit | null;
}

interface ActionStateDoc {
  runId: string;
  state: ActionState;
  updatedAt: string;
}

async function readState(runId: string): Promise<ActionState | null> {
  const doc = (await getConvexClient().query(backendApi.actionStates.get, {
    runId,
  })) as ActionStateDoc | null;
  return doc?.state ?? null;
}

async function saveState(state: ActionState): Promise<void> {
  await getConvexClient().mutation(backendApi.actionStates.save, {
    runId: state.runId,
    state,
    updatedAt: new Date().toISOString(),
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Register or update an action's state. */
export async function upsertActionState(
  update: Partial<ActionState> & { runId: string; actionId: string },
  _opts: ActionStateOpts = {},
): Promise<ActionState> {
  const existing = await readState(update.runId);

  let updated: ActionState;
  if (existing) {
    if (update.actionId !== existing.actionId) return existing; // Reject different instance
    updated = {
      ...existing,
      ...update,
      lastHeartbeat: new Date().toISOString(),
    };
  } else {
    updated = {
      runId: update.runId,
      actionId: update.actionId,
      sessionId: update.sessionId,
      taskId: update.taskId,
      status: update.status ?? "running",
      step: update.step ?? "",
      instructions: update.instructions ?? [],
      cancel: false,
      cancelledBy: undefined,
      lastHeartbeat: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  await saveState(updated);
  return updated;
}

/** Poll for the next instruction (FIFO). Returns instruction + cancel state. */
export async function pollInstruction(
  runId: string,
  _callerActionId: string,
  _opts: ActionStateOpts = {},
): Promise<{
  instruction: string | null;
  cancel: boolean;
  cancelledBy: string | null;
  actionId: string;
}> {
  const state = await readState(runId);
  if (!state)
    return {
      instruction: null,
      cancel: false,
      cancelledBy: null,
      actionId: "",
    };

  // Dequeue first instruction (immutably — write back the shortened queue).
  const [instruction = null, ...rest] = state.instructions;
  if (instruction !== null) {
    await saveState({ ...state, instructions: rest });
  }

  return {
    instruction,
    cancel: state.cancel,
    cancelledBy: state.cancelledBy ?? null,
    actionId: state.actionId,
  };
}

/** Enqueue an instruction for an action. */
export async function enqueueInstruction(
  runId: string,
  instruction: string,
  _opts: ActionStateOpts = {},
): Promise<boolean> {
  const state = await readState(runId);
  if (!state) return false;

  await saveState({
    ...state,
    instructions: [...state.instructions, instruction],
  });
  return true;
}

/** Get full state for a runId. */
export async function getActionState(
  runId: string,
  _opts: ActionStateOpts = {},
): Promise<ActionState | null> {
  return readState(runId);
}

/** List all action states. */
export async function listActionStates(
  _opts: ActionStateOpts = {},
): Promise<ActionState[]> {
  const docs = (await getConvexClient().query(
    backendApi.actionStates.list,
    {},
  )) as ActionStateDoc[];
  return docs.map((doc) => doc.state);
}

/** Cancel an action. */
export async function cancelAction(
  runId: string,
  cancelledBy: string,
  _opts: ActionStateOpts = {},
): Promise<ActionState | null> {
  const state = await readState(runId);
  if (!state) return null;

  const cancelled: ActionState = { ...state, cancel: true, cancelledBy };
  await saveState(cancelled);
  return cancelled;
}

/** Delete an action state. */
export async function deleteActionState(
  runId: string,
  _opts: ActionStateOpts = {},
): Promise<boolean> {
  return (await getConvexClient().mutation(backendApi.actionStates.remove, {
    runId,
  })) as boolean;
}
