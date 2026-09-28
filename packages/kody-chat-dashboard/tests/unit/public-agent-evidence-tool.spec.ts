import { describe, expect, it, vi } from "vitest";

import { createPublicAgentEvidenceTool } from "../../app/api/kody/chat/kody/public-agent-evidence-tool";

const agents = [
  { slug: "security", title: "Security", body: "Review security." },
  { slug: "ux", title: "UX", body: "Review usability." },
];

async function lastToolOutput(execution: unknown): Promise<unknown> {
  if (
    execution &&
    typeof execution === "object" &&
    Symbol.asyncIterator in execution
  ) {
    let latest: unknown;
    for await (const output of execution as AsyncIterable<unknown>) {
      latest = output;
    }
    return latest;
  }
  return await execution;
}

describe("public Agent evidence tool", () => {
  it("runs validated assignments and returns their evidence to Kody", async () => {
    const run = vi.fn().mockResolvedValue([
      {
        status: "completed",
        agent: "security",
        result: "The route is protected.",
        evidence: "Middleware requires a verified session.",
      },
    ]);
    const evidenceTool = createPublicAgentEvidenceTool({ agents, run });

    const result = await lastToolOutput(
      evidenceTool.execute?.(
        {
          assignments: [
            { agent: "security", task: "Check route authentication" },
          ],
        },
        {} as never,
      ),
    );

    expect(run).toHaveBeenCalledWith(
      [{ agent: "security", task: "Check route authentication" }],
      expect.any(AbortSignal),
    );
    expect(result).toEqual({
      status: "completed",
      findings: [
        {
          status: "completed",
          agent: "security",
          result: "The route is protected.",
          evidence: "Middleware requires a verified session.",
        },
      ],
    });
  });

  it("rejects agents outside Kody's assigned roster", async () => {
    const run = vi.fn();
    const evidenceTool = createPublicAgentEvidenceTool({ agents, run });

    const result = await lastToolOutput(
      evidenceTool.execute?.(
        { assignments: [{ agent: "unknown", task: "Do work" }] },
        {} as never,
      ),
    );

    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "rejected",
      error: "Only assigned specialists may be requested: unknown.",
    });
  });

  it("rejects duplicate, empty, and excessive assignments", async () => {
    const run = vi.fn();
    const evidenceTool = createPublicAgentEvidenceTool({ agents, run });

    await expect(
      lastToolOutput(
        evidenceTool.execute?.(
          {
            assignments: [
              { agent: "security", task: "first" },
              { agent: "security", task: "second" },
            ],
          },
          {} as never,
        ),
      ),
    ).resolves.toMatchObject({ status: "rejected" });
    expect(run).not.toHaveBeenCalled();
  });

  it("allows only one specialist evidence call in a Kody turn", async () => {
    const run = vi.fn().mockResolvedValue([]);
    const evidenceTool = createPublicAgentEvidenceTool({ agents, run });
    const input = { assignments: [{ agent: "security", task: "Review it" }] };

    await lastToolOutput(evidenceTool.execute?.(input, {} as never));
    const second = await lastToolOutput(
      evidenceTool.execute?.(input, {} as never),
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(second).toEqual({
      status: "rejected",
      error: "Specialist evidence was already requested in this turn.",
    });
  });

  it("settles a specialist exception as a failed finding", async () => {
    const evidenceTool = createPublicAgentEvidenceTool({
      agents,
      run: vi.fn().mockRejectedValue(new Error("provider disconnected")),
    });

    const result = await lastToolOutput(
      evidenceTool.execute?.(
        { assignments: [{ agent: "security", task: "Review it" }] },
        {} as never,
      ),
    );

    expect(result).toEqual({
      status: "completed",
      findings: [
        {
          status: "failed",
          agent: "security",
          failure: "provider_error",
        },
      ],
    });
  });

  it("settles a specialist that never returns and aborts its work", async () => {
    vi.useFakeTimers();
    const run = vi.fn(
      (_assignments, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const evidenceTool = createPublicAgentEvidenceTool({ agents, run });
    const resultPromise = lastToolOutput(
      evidenceTool.execute?.(
        { assignments: [{ agent: "security", task: "Review it" }] },
        {} as never,
      ),
    );

    await vi.advanceTimersByTimeAsync(240_000);

    await expect(resultPromise).resolves.toEqual({
      status: "completed",
      findings: [
        {
          status: "failed",
          agent: "security",
          failure: "timeout",
        },
      ],
    });
    expect(run.mock.calls[0]?.[1]?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("streams progress while specialist evidence is still running", async () => {
    vi.useFakeTimers();
    let resolveRun!: (results: Array<Record<string, unknown>>) => void;
    const run = vi.fn(
      () =>
        new Promise<Array<Record<string, unknown>>>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const evidenceTool = createPublicAgentEvidenceTool({
      agents,
      run: run as never,
      heartbeatMs: 30_000,
    });
    const execution = evidenceTool.execute?.(
      { assignments: [{ agent: "security", task: "Review it" }] },
      {} as never,
    );
    const iterator = (
      execution as AsyncIterable<Record<string, unknown>>
    )[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { status: "running" },
    });
    const heartbeat = iterator.next();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(heartbeat).resolves.toMatchObject({
      done: false,
      value: { status: "running" },
    });

    resolveRun([
      { status: "completed", agent: "security", result: "Grounded." },
    ]);
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { status: "completed" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    vi.useRealTimers();
  });
});
