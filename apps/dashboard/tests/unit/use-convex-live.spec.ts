/**
 * Unit tests for the Convex live-subscription hooks
 * (src/dashboard/lib/hooks/useConvexLive.ts): chatEvents.since tail mapping,
 * workflowRuns.list latest-run derivation, skip args without auth/session,
 * and the polling fallback (undefined) when NEXT_PUBLIC_CONVEX_URL is unset.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const reactClient = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: reactClient.useQuery,
  ConvexProvider: ({ children }: { children: unknown }) => children,
  ConvexReactClient: class {},
}));

const auth = vi.hoisted(() => ({
  getStoredAuth: vi.fn(),
}));
vi.mock("@dashboard/lib/api", () => ({
  getStoredAuth: auth.getStoredAuth,
}));

const RUN_STATE = {
  status: "running",
  completedStepIds: [],
  transitionCounts: {},
  facts: {},
  evidence: {},
  artifacts: [],
};

async function loadHooks(convexUrl: string | undefined) {
  vi.resetModules();
  if (convexUrl === undefined) {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
  } else {
    process.env.NEXT_PUBLIC_CONVEX_URL = convexUrl;
  }
  return import("@dashboard/lib/hooks/useConvexLive");
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getStoredAuth.mockReturnValue({
    token: "t",
    owner: "acme",
    repo: "widgets",
  });
});

describe("useChatEventsLive", () => {
  it("maps the reactive chatEvents.since tail to events", async () => {
    const { useChatEventsLive } = await loadHooks("https://x.convex.cloud");
    reactClient.useQuery.mockReturnValue([
      { seq: 0, event: { event: "chat.ready", payload: {}, runId: "r1" } },
      { seq: 1, event: { event: "chat.done", payload: {}, runId: "r1" } },
    ]);

    const events = useChatEventsLive("s1", -1);

    const [ref, args] = reactClient.useQuery.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("chatEvents:since");
    expect(args).toEqual({ tenantId: "global", sessionId: "s1", afterSeq: -1 });
    expect(events?.map((e) => e.event)).toEqual(["chat.ready", "chat.done"]);
  });

  it("skips the subscription without a sessionId", async () => {
    const { useChatEventsLive } = await loadHooks("https://x.convex.cloud");
    reactClient.useQuery.mockReturnValue(undefined);

    expect(useChatEventsLive(undefined)).toBeUndefined();
    expect(reactClient.useQuery.mock.calls[0]![1]).toBe("skip");
  });

  it("returns undefined (polling fallback) when Convex live is disabled", async () => {
    const { useChatEventsLive } = await loadHooks(undefined);

    expect(useChatEventsLive("s1")).toBeUndefined();
    expect(reactClient.useQuery).not.toHaveBeenCalled();
  });
});

describe("useWorkflowRunStateLive", () => {
  it("derives the latest run-* entry from workflowRuns.list", async () => {
    const { useWorkflowRunStateLive } = await loadHooks(
      "https://x.convex.cloud",
    );
    reactClient.useQuery.mockReturnValue([
      {
        runId: "run-z",
        state: { ...RUN_STATE, status: "done" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        runId: "run-a",
        state: RUN_STATE,
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      { runId: "draft", state: RUN_STATE },
    ]);

    const record = useWorkflowRunStateLive("wf1");

    const [ref, args] = reactClient.useQuery.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("workflowRuns:list");
    expect(args).toEqual({ tenantId: "acme/widgets", workflowId: "wf1" });
    expect(record).toMatchObject({
      workflowId: "wf1",
      runId: "run-a",
      state: { status: "running" },
    });
  });

  it("returns the requested run when runId is given", async () => {
    const { useWorkflowRunStateLive } = await loadHooks(
      "https://x.convex.cloud",
    );
    reactClient.useQuery.mockReturnValue([
      { runId: "run-a", state: { ...RUN_STATE, status: "done" } },
      { runId: "run-b", state: RUN_STATE },
    ]);

    const record = useWorkflowRunStateLive("wf1", "run-a");

    expect(record).toMatchObject({ runId: "run-a", state: { status: "done" } });
  });

  it("returns null when the workflow has no runs yet", async () => {
    const { useWorkflowRunStateLive } = await loadHooks(
      "https://x.convex.cloud",
    );
    reactClient.useQuery.mockReturnValue([]);

    expect(useWorkflowRunStateLive("wf1")).toBeNull();
  });

  it("skips the subscription without stored auth", async () => {
    auth.getStoredAuth.mockReturnValue(null);
    const { useWorkflowRunStateLive } = await loadHooks(
      "https://x.convex.cloud",
    );
    reactClient.useQuery.mockReturnValue(undefined);

    expect(useWorkflowRunStateLive("wf1")).toBeUndefined();
    expect(reactClient.useQuery.mock.calls[0]![1]).toBe("skip");
  });

  it("returns undefined (polling fallback) when Convex live is disabled", async () => {
    const { useWorkflowRunStateLive } = await loadHooks(undefined);

    expect(useWorkflowRunStateLive("wf1")).toBeUndefined();
    expect(reactClient.useQuery).not.toHaveBeenCalled();
  });
});
