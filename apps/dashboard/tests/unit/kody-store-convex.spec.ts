/**
 * Unit tests for the Convex-backed kody-store: action-state
 * (actionStates.{get,save,list,remove}) and event-log
 * (eventLog.{append,forRun,recent}) wiring, FIFO instruction queue
 * semantics, and instance-guarded upserts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const convex = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = convex.query;
    mutation = convex.mutation;
  },
}));

import { _resetConvexClient } from "@dashboard/lib/backend/convex-backend";
import {
  cancelAction,
  deleteActionState,
  enqueueInstruction,
  getActionState,
  listActionStates,
  pollInstruction,
  upsertActionState,
  type ActionState,
} from "@dashboard/lib/kody-store/action-state";
import {
  getAllEvents,
  getEventHistory,
  getLastEvent,
  logEvent,
} from "@dashboard/lib/kody-store/event-log";

const STATE: ActionState = {
  runId: "run1",
  actionId: "act1",
  status: "running",
  step: "boot",
  instructions: ["first", "second"],
  cancel: false,
  lastHeartbeat: "2026-07-15T00:00:00.000Z",
  createdAt: "2026-07-15T00:00:00.000Z",
};

function mockGet(state: ActionState | null) {
  convex.query.mockResolvedValue(
    state ? { runId: state.runId, state, updatedAt: "t" } : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
  convex.mutation.mockResolvedValue("id");
});

describe("action-state store", () => {
  it("creates a fresh state via actionStates.save", async () => {
    mockGet(null);

    const created = await upsertActionState({ runId: "run1", actionId: "a" });

    expect(created).toMatchObject({
      runId: "run1",
      actionId: "a",
      status: "running",
      instructions: [],
      cancel: false,
    });
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("actionStates:save");
    expect(args.runId).toBe("run1");
    expect(args.state).toEqual(created);
  });

  it("rejects updates from a different actionId instance", async () => {
    mockGet(STATE);

    const result = await upsertActionState({
      runId: "run1",
      actionId: "other",
      step: "hijack",
    });

    expect(result).toEqual(STATE);
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("polls instructions FIFO and writes back the shortened queue", async () => {
    mockGet(STATE);

    const result = await pollInstruction("run1", "act1");

    expect(result.instruction).toBe("first");
    expect(result.cancel).toBe(false);
    const saved = convex.mutation.mock.calls[0]![1].state as ActionState;
    expect(saved.instructions).toEqual(["second"]);
  });

  it("returns empty poll result without writing when no state exists", async () => {
    mockGet(null);

    const result = await pollInstruction("nope", "a");

    expect(result).toEqual({
      instruction: null,
      cancel: false,
      cancelledBy: null,
      actionId: "",
    });
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("enqueues an instruction at the back of the queue", async () => {
    mockGet(STATE);

    expect(await enqueueInstruction("run1", "third")).toBe(true);
    const saved = convex.mutation.mock.calls[0]![1].state as ActionState;
    expect(saved.instructions).toEqual(["first", "second", "third"]);
  });

  it("cancels an action and records who cancelled", async () => {
    mockGet(STATE);

    const cancelled = await cancelAction("run1", "octocat");

    expect(cancelled).toMatchObject({ cancel: true, cancelledBy: "octocat" });
    expect(convex.mutation.mock.calls[0]![1].state.cancel).toBe(true);
  });

  it("reads, lists, and deletes through the Convex functions", async () => {
    mockGet(STATE);
    expect(await getActionState("run1")).toEqual(STATE);
    expect(getFunctionName(convex.query.mock.calls[0]![0])).toBe(
      "actionStates:get",
    );

    convex.query.mockResolvedValue([{ runId: "run1", state: STATE }]);
    expect(await listActionStates()).toEqual([STATE]);
    expect(getFunctionName(convex.query.mock.calls[1]![0])).toBe(
      "actionStates:list",
    );

    convex.mutation.mockResolvedValue(true);
    expect(await deleteActionState("run1")).toBe(true);
    expect(getFunctionName(convex.mutation.mock.calls[0]![0])).toBe(
      "actionStates:remove",
    );
  });
});

describe("event-log store", () => {
  const DOC = {
    entryId: "e1",
    runId: "run1",
    event: "step.done",
    payload: { runId: "run1" },
    channel: "pipeline",
    emittedAt: "2026-07-15T00:00:00.000Z",
  };

  it("appends entries via eventLog.append", async () => {
    const entry = await logEvent("step.done", { runId: "run1", ok: true });

    expect(entry.runId).toBe("run1");
    expect(entry.channel).toBe("pipeline");
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("eventLog:append");
    expect(args).toMatchObject({
      runId: "run1",
      event: "step.done",
      payload: { runId: "run1", ok: true },
      channel: "pipeline",
    });
    expect(typeof args.entryId).toBe("string");
  });

  it("reads run history via eventLog.forRun", async () => {
    convex.query.mockResolvedValue([DOC]);

    const history = await getEventHistory("run1");

    expect(getFunctionName(convex.query.mock.calls[0]![0])).toBe(
      "eventLog:forRun",
    );
    expect(history).toEqual([
      {
        id: "e1",
        runId: "run1",
        event: "step.done",
        payload: { runId: "run1" },
        channel: "pipeline",
        emittedAt: DOC.emittedAt,
      },
    ]);
  });

  it("reads recent events and the last event of a run", async () => {
    convex.query.mockResolvedValue([DOC, { ...DOC, entryId: "e2" }]);

    const all = await getAllEvents();
    expect(getFunctionName(convex.query.mock.calls[0]![0])).toBe(
      "eventLog:recent",
    );
    expect(convex.query.mock.calls[0]![1]).toEqual({ limit: 1000 });
    expect(all).toHaveLength(2);

    const last = await getLastEvent("run1");
    expect(last?.id).toBe("e2");
  });
});
