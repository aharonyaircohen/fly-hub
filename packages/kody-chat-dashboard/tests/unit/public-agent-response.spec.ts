import { describe, expect, it, vi } from "vitest";

import { writePublicAgentResponse } from "../../app/api/kody/chat/kody/public-agent-response";

const decision = {
  mode: "delegate" as const,
  assignments: [{ agent: "agency-specialist", task: "Explain Agency" }],
};
const activities = [
  {
    id: "activity-1",
    assignment: decision.assignments[0]!,
    title: "Agency Specialist",
  },
];

describe("public Agent response", () => {
  it("keeps a silent long-running specialist turn active", async () => {
    vi.useFakeTimers();
    let finishOrchestration!: () => void;
    const orchestrationGate = new Promise<void>((resolve) => {
      finishOrchestration = resolve;
    });
    const events: unknown[] = [];
    const response = writePublicAgentResponse({
      writer: { write: (event) => events.push(event) },
      traceId: "trace-heartbeat",
      messageId: "message-heartbeat",
      activities,
      heartbeatMs: 30_000,
      runOrchestration: vi.fn(async () => {
        await orchestrationGate;
        return {
          parentTools: {},
          results: [
            {
              status: "completed" as const,
              agent: "agency-specialist",
              result: "Completed after a silent research period.",
            },
          ],
        };
      }),
      synthesize: vi.fn(async () => "Completed assessment."),
    });

    await vi.advanceTimersByTimeAsync(90_000);
    expect(
      events.filter(
        (event) =>
          (event as { type?: string }).type === "data-subagent-activity" &&
          (event as { data?: { phase?: string } }).data?.phase === "started",
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          (event as { type?: string }).type === "data-subagent-activity" &&
          (event as { data?: { phase?: string } }).data?.phase === "heartbeat",
      ),
    ).toHaveLength(3);

    finishOrchestration();
    await expect(response).resolves.toMatchObject({
      text: "Completed assessment.",
    });
    vi.useRealTimers();
  });

  it("keeps a silent long-running final synthesis active", async () => {
    vi.useFakeTimers();
    let finishSynthesis!: () => void;
    const synthesisGate = new Promise<void>((resolve) => {
      finishSynthesis = resolve;
    });
    const events: unknown[] = [];
    const response = writePublicAgentResponse({
      writer: { write: (event) => events.push(event) },
      traceId: "trace-synthesis-heartbeat",
      messageId: "message-synthesis-heartbeat",
      activities,
      heartbeatMs: 30_000,
      runOrchestration: vi.fn(async () => ({
        parentTools: {},
        results: [
          {
            status: "completed" as const,
            agent: "agency-specialist",
            result: "Specialist evidence.",
          },
        ],
      })),
      synthesize: vi.fn(async () => {
        await synthesisGate;
        return "Completed assessment.";
      }),
    });

    await vi.advanceTimersByTimeAsync(90_000);
    expect(
      events.filter(
        (event) =>
          (event as { type?: string }).type === "data-subagent-activity" &&
          (event as { data?: { phase?: string } }).data?.phase === "heartbeat",
      ),
    ).toHaveLength(3);

    finishSynthesis();
    await expect(response).resolves.toMatchObject({
      text: "Completed assessment.",
    });
    vi.useRealTimers();
  });

  it("keeps parallel tasks from the same specialist distinct", async () => {
    const repeatedActivities = [
      {
        id: "activity-architecture",
        assignment: {
          agent: "agency-specialist",
          task: "Map architecture",
        },
        title: "Project Assessor",
      },
      {
        id: "activity-tests",
        assignment: {
          agent: "agency-specialist",
          task: "Inspect test health",
        },
        title: "Project Assessor",
      },
    ];
    const events: unknown[] = [];
    const synthesize = vi.fn(async () => "Combined assessment.");

    await expect(
      writePublicAgentResponse({
        writer: { write: (event) => events.push(event) },
        traceId: "trace-repeated-agent",
        messageId: "message-repeated-agent",
        activities: repeatedActivities,
        runOrchestration: vi.fn(async () => ({
          parentTools: {},
          results: [
            {
              status: "completed" as const,
              agent: "agency-specialist",
              result: "Architecture result",
            },
            {
              status: "failed" as const,
              agent: "agency-specialist",
              failure: { code: "timeout" as const },
            },
          ],
        })),
        synthesize,
      }),
    ).resolves.toMatchObject({
      text: "Combined assessment.",
      allSpecialistsFailed: false,
      returnedFailure: false,
    });

    expect(synthesize).toHaveBeenCalledWith([
      expect.objectContaining({
        status: "completed",
        result: "Architecture result",
      }),
      expect.objectContaining({
        status: "failed",
        failure: { code: "timeout" },
      }),
    ]);
    expect(events).toContainEqual({
      type: "data-subagent-activity",
      data: expect.objectContaining({
        id: "activity-architecture",
        phase: "completed",
      }),
    });
    expect(events).toContainEqual({
      type: "data-subagent-activity",
      data: expect.objectContaining({
        id: "activity-tests",
        phase: "failed",
      }),
    });
  });

  it("hands completed specialist work back to the parent presenter", async () => {
    const events: unknown[] = [];
    const showView = { description: "render a form" };
    const present = vi.fn(async (_results, parentTools, writer) => {
      expect(parentTools).toEqual({ show_view: showView });
      writer.write({
        type: "tool-input-available",
        toolCallId: "todo-form",
        toolName: "show_view",
        input: { purpose: "guided-form" },
      });
      writer.write({
        type: "tool-output-available",
        toolCallId: "todo-form",
        output: { action: "render_view" },
      });
      return "Presented a Todo form.";
    });
    const synthesize = vi.fn();

    await expect(
      writePublicAgentResponse({
        writer: { write: (event) => events.push(event) },
        traceId: "trace-present",
        messageId: "message-present",
        activities,
        runOrchestration: vi.fn(async () => ({
          parentTools: { show_view: showView },
          results: [
            {
              status: "completed" as const,
              agent: "agency-specialist",
              sessionId: "todo-child-session",
              result: "A Todo list needs a name before creation.",
              reference: "Todos are managed by Agency.",
            },
          ],
        })),
        present,
        synthesize,
      }),
    ).resolves.toMatchObject({
      text: "Presented a Todo form.",
      returnedFailure: false,
      childSessionIds: ["todo-child-session"],
    });

    expect(present).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ agent: "agency-specialist" }),
      ]),
      { show_view: showView },
      expect.objectContaining({ write: expect.any(Function) }),
    );
    expect(synthesize).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-input-available",
        toolName: "show_view",
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text-start" }),
    );
  });

  it("lets a report workflow bypass generic presentation and use dedicated synthesis", async () => {
    const events: unknown[] = [];
    const synthesize = vi.fn(async () => "Complete published report.");

    await expect(
      writePublicAgentResponse({
        writer: { write: (event) => events.push(event) },
        traceId: "trace-report",
        messageId: "message-report",
        activities,
        runOrchestration: vi.fn(async () => ({
          parentTools: {},
          results: [
            {
              status: "completed" as const,
              agent: "agency-specialist",
              result: "Specialist evidence.",
            },
          ],
        })),
        present: vi.fn(async () => null),
        synthesize,
      }),
    ).resolves.toMatchObject({ text: "Complete published report." });

    expect(synthesize).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      type: "text-delta",
      id: "message-report",
      delta: "Complete published report.",
    });
  });

  it("streams specialist progress, the final answer, and durable completion", async () => {
    const events: unknown[] = [];
    const complete = vi.fn(async () => undefined);
    const recordProgress = vi.fn();
    const result = {
      status: "completed" as const,
      agent: "agency-specialist",
      sessionId: "child-session",
      result: "Agency source result",
      reasoning: "Checked the Agency definition.",
      reference: "Agency owns Agents and Capabilities.",
    };
    const runOrchestration = vi.fn(async (onReasoningDelta) => {
      onReasoningDelta({
        agent: "agency-specialist",
        assignmentIndex: 0,
        delta: "Checking Agency…",
      });
      return { parentTools: {}, results: [result] };
    });

    await expect(
      writePublicAgentResponse({
        writer: { write: (event) => events.push(event) },
        traceId: "trace-1",
        messageId: "message-1",
        activities,
        runOrchestration,
        synthesize: vi.fn(async () => "Agency is structured clearly."),
        startDurableTurn: () => ({
          complete,
          fail: vi.fn(async () => undefined),
          recordProgress,
          saveRecovery: vi.fn(async () => undefined),
        }),
      }),
    ).resolves.toEqual({
      text: "Agency is structured clearly.",
      allSpecialistsFailed: false,
      returnedFailure: false,
      synthesisFailed: false,
      childSessionIds: ["child-session"],
    });

    expect(events).toEqual([
      {
        type: "data-subagent-activity",
        data: {
          id: "activity-1",
          phase: "started",
          agentTitle: "Agency Specialist",
          task: "Explain Agency",
        },
      },
      {
        type: "data-subagent-activity",
        data: {
          id: "activity-1",
          phase: "reasoning",
          agentTitle: "Agency Specialist",
          reasoningDelta: "Checking Agency…",
        },
      },
      {
        type: "data-subagent-activity",
        data: {
          id: "activity-1",
          phase: "completed",
          agentTitle: "Agency Specialist",
        },
      },
      { type: "text-start", id: "message-1" },
      {
        type: "text-delta",
        id: "message-1",
        delta: "Agency is structured clearly.",
      },
      { type: "text-end", id: "message-1" },
    ]);
    expect(complete).toHaveBeenCalledWith("Agency is structured clearly.");
    expect(recordProgress).toHaveBeenLastCalledWith({
      reasoning: "Agency Specialist:\nChecking Agency…",
      toolCalls: [
        {
          id: "activity-1",
          name: "subagent",
          arguments: { task: "Explain Agency" },
          description: "Working on delegated specialist research.",
          status: "success",
          activityKind: "subagent",
          displayName: "Agency Specialist",
        },
      ],
    });
  });

  it("returns a safe failure without synthesizing when every specialist fails", async () => {
    const events: unknown[] = [];
    const synthesize = vi.fn();
    const onSpecialistFailure = vi.fn();

    const failureResult = await writePublicAgentResponse({
      writer: { write: (event) => events.push(event) },
      traceId: "trace-2",
      messageId: "message-2",
      activities,
      runOrchestration: vi.fn(async () => ({
        parentTools: {},
        results: [
          {
            status: "failed" as const,
            agent: "agency-specialist",
            sessionId: "failed-session",
            failure: {
              code: "provider_error" as const,
              detail: "provider secret detail",
            },
          },
        ],
      })),
      synthesize,
      onSpecialistFailure,
    });

    expect(failureResult).toMatchObject({
      allSpecialistsFailed: true,
      returnedFailure: true,
    });
    expect(failureResult.text).toMatch(/\?$/);

    expect(synthesize).not.toHaveBeenCalled();
    expect(onSpecialistFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "agency-specialist",
        sessionId: "failed-session",
        failure: {
          code: "provider_error",
          detail: "provider secret detail",
        },
      }),
    );
    expect(events).toContainEqual({
      type: "data-subagent-activity",
      data: expect.objectContaining({
        phase: "failed",
        errorText: expect.stringContaining("(trace trace-2)"),
      }),
    });
  });

  it("uses the reliable fallback when synthesis fails", async () => {
    const onSynthesisFailure = vi.fn();

    await expect(
      writePublicAgentResponse({
        writer: { write: vi.fn() },
        traceId: "trace-3",
        messageId: "message-3",
        activities,
        runOrchestration: vi.fn(async () => ({
          parentTools: {},
          results: [
            {
              status: "completed" as const,
              agent: "agency-specialist",
              result: "Agency source result",
            },
          ],
        })),
        synthesize: vi.fn(async () => {
          throw new Error("synthesis unavailable");
        }),
        onSynthesisFailure,
      }),
    ).resolves.toMatchObject({
      text: "I could not prepare a reliable answer from the available specialist evidence. Would you like me to retry or use another model?",
    });
    expect(onSynthesisFailure).toHaveBeenCalledWith(expect.any(Error));
  });

  it("marks a returned final-report failure as a failed outcome", async () => {
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);

    const outcome = await writePublicAgentResponse({
      writer: { write: vi.fn() },
      traceId: "trace-report-failure",
      messageId: "message-report-failure",
      activities,
      runOrchestration: vi.fn(async () => ({
        parentTools: {},
        results: [
          {
            status: "completed" as const,
            agent: "agency-specialist",
            result: "Specialist evidence.",
          },
        ],
      })),
      synthesize: vi.fn(
        async () =>
          "Final report writing failed because the provider rejected the request.",
      ),
      startDurableTurn: () => ({
        recordProgress: vi.fn(),
        saveRecovery: vi.fn(async () => undefined),
        complete,
        fail,
      }),
    });

    expect(outcome).toMatchObject({ synthesisFailed: true });
    expect(fail).toHaveBeenCalledWith(
      "specialist_synthesis_failed",
      "Final report writing failed because the provider rejected the request.",
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it("falls back to grounded text when parent presentation fails", async () => {
    const events: unknown[] = [];
    const onSynthesisFailure = vi.fn();
    const synthesize = vi.fn(async () => "Grounded Agency answer.");

    await expect(
      writePublicAgentResponse({
        writer: { write: (event) => events.push(event) },
        traceId: "trace-presentation-fallback",
        messageId: "message-presentation-fallback",
        activities,
        runOrchestration: vi.fn(async () => ({
          parentTools: { show_view: {} },
          results: [
            {
              status: "completed" as const,
              agent: "agency-specialist",
              result: "Grounded Agency result.",
              reference: "Agency reference.",
            },
          ],
        })),
        present: vi.fn(async () => {
          throw new Error("renderer provider unavailable");
        }),
        synthesize,
        onSynthesisFailure,
      }),
    ).resolves.toMatchObject({ text: "Grounded Agency answer." });

    expect(onSynthesisFailure).toHaveBeenCalledWith(expect.any(Error));
    expect(synthesize).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      type: "text-delta",
      id: "message-presentation-fallback",
      delta: "Grounded Agency answer.",
    });
  });

  it("fails every activity and the durable turn when orchestration throws", async () => {
    const events: unknown[] = [];
    const fail = vi.fn(async () => undefined);
    const synthesize = vi.fn();
    const onOrchestrationFailure = vi.fn();

    await expect(
      writePublicAgentResponse({
        writer: { write: (event) => events.push(event) },
        traceId: "trace-4",
        messageId: "message-4",
        activities,
        runOrchestration: vi.fn(async () => {
          throw new Error("private orchestration detail");
        }),
        synthesize,
        startDurableTurn: () => ({
          recordProgress: vi.fn(),
          saveRecovery: vi.fn(async () => undefined),
          complete: vi.fn(async () => undefined),
          fail,
        }),
        onOrchestrationFailure,
      }),
    ).resolves.toMatchObject({
      allSpecialistsFailed: true,
      returnedFailure: true,
    });

    expect(synthesize).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith("specialist_orchestration_failed");
    expect(onOrchestrationFailure).toHaveBeenCalledWith(expect.any(Error));
    expect(events).toContainEqual({
      type: "data-subagent-activity",
      data: expect.objectContaining({
        phase: "failed",
        errorText: expect.stringContaining("trace trace-4"),
      }),
    });
  });

  it("treats a missing assignment result as a failure", async () => {
    const events: unknown[] = [];
    const synthesize = vi.fn();

    await expect(
      writePublicAgentResponse({
        writer: { write: (event) => events.push(event) },
        traceId: "trace-5",
        messageId: "message-5",
        activities,
        runOrchestration: vi.fn(async () => ({
          parentTools: {},
          results: [],
        })),
        synthesize,
      }),
    ).resolves.toMatchObject({
      allSpecialistsFailed: true,
      returnedFailure: true,
    });

    expect(synthesize).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "data-subagent-activity",
      data: expect.objectContaining({
        phase: "failed",
        errorText: expect.stringContaining("did not return a result"),
      }),
    });
  });
});
