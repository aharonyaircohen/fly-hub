import { describe, expect, it } from "vitest";
import {
  createAgentState,
  createAgencyRequestState,
  createLoopDefinition,
  nextLoopRunAt,
  createRun,
  createTodo,
  createWorkflowDefinition,
} from "../src/index";

describe("simple AI Agency domain", () => {
  it("accepts a Store Blueprint as an Agency request source", () => {
    const state = createAgencyRequestState({
      phase: "waiting-approval",
      source: {
        kind: "store-blueprint",
        blueprintId: "healthy-ci",
        requestId: "request-1",
      },
      requirement: { outcome: "Build Healthy CI" },
      questions: [],
      plan: ["Apply the Blueprint"],
      evidence: [],
      blockers: [],
      related: [{ kind: "strategy", id: "healthy-ci" }],
    });

    expect(state.source).toEqual({
      kind: "store-blueprint",
      blueprintId: "healthy-ci",
      requestId: "request-1",
    });
  });

  it("keeps Agency request lifecycle state inside Todo metadata", () => {
    expect(
      createAgencyRequestState({
        phase: "assessing",
        source: {
          kind: "guided-flow",
          instanceId: "request-1",
          effectId: "effect-1",
        },
        requirement: {
          outcome: "Keep CI healthy",
          activation: "When CI fails on main",
          permissions: "Create a pull request; do not merge it",
          success: "The latest main CI run is green",
          context: "Use the installed CI Repair solution when compatible",
        },
        questions: [],
        plan: [],
        related: [],
      }),
    ).toMatchObject({
      phase: "assessing",
      requirement: { outcome: "Keep CI healthy" },
    });

    expect(
      createAgencyRequestState({
        phase: "waiting-approval",
        source: {
          kind: "guided-flow",
          instanceId: "request-1",
          effectId: "effect-1",
        },
        requirement: { outcome: "Keep CI healthy" },
        questions: [],
        plan: ["Run the installed CI Repair workflow"],
        execution: {
          workflowId: "ci-repair",
          input: { branch: "main", ciRunId: 123 },
          activations: [{ kind: "solution", id: "ci-repair" }],
        },
        evidence: [],
        blockers: [],
        related: [
          { kind: "strategy", id: "healthy-ci" },
          { kind: "workflow", id: "ci-repair" },
        ],
      }),
    ).toMatchObject({
      execution: {
        workflowId: "ci-repair",
        input: { branch: "main" },
        activations: [{ kind: "solution", id: "ci-repair" }],
      },
      evidence: [],
      blockers: [],
    });

    expect(() =>
      createAgencyRequestState({
        phase: "running",
        source: {
          kind: "guided-flow",
          instanceId: "request-1",
          effectId: "effect-1",
        },
        requirement: { outcome: "Keep CI healthy" },
        questions: [],
        plan: [],
        evidence: [],
        blockers: [],
        related: [],
        workflowId: "ci-repair",
      }),
    ).toThrow(/unknown field "workflowId"/i);
  });

  it("accepts a completion Report as an Agency request relation", () => {
    const request = createAgencyRequestState({
      phase: "done",
      source: {
        kind: "store-blueprint",
        blueprintId: "healthy-ci",
        requestId: "request-1",
      },
      requirement: { outcome: "Build Healthy CI" },
      questions: [],
      plan: [],
      evidence: ["CI passed"],
      blockers: [],
      related: [
        { kind: "strategy", id: "healthy-ci" },
        { kind: "report", id: "agency-request-healthy-ci" },
      ],
    });

    expect(request.related).toContainEqual({
      kind: "report",
      id: "agency-request-healthy-ci",
    });
  });

  it("puts one Agent on the Workflow, not its steps", () => {
    expect(
      createWorkflowDefinition({
        id: "release",
        agent: "developer",
        steps: [
          {
            id: "inspect",
            capabilityRef: { kind: "capability", id: "inspect" },
          },
          {
            id: "publish",
            capabilityRef: { kind: "capability", id: "publish" },
            dependsOn: ["inspect"],
            condition: "inspect.succeeded",
          },
        ],
      }),
    ).toMatchObject({ id: "release", agent: "developer" });
    expect(() =>
      createWorkflowDefinition({
        id: "release",
        agent: "developer",
        steps: [
          {
            id: "inspect",
            capabilityRef: { kind: "capability", id: "inspect" },
            agent: "reviewer",
          },
        ],
      }),
    ).toThrow(/unknown field "agent"/i);
  });

  it("keeps Todo finite and free of execution configuration", () => {
    expect(
      createTodo({
        id: "ship-release",
        outcome: "The release is live",
        status: "in-progress",
        evidence: ["deployment-url"],
        checklist: [{ id: "verify", text: "Verify release", done: false }],
        blockers: [],
        runIds: ["run-1"],
      }),
    ).toMatchObject({ status: "in-progress", runIds: ["run-1"] });
    expect(() =>
      createTodo({
        id: "ship-release",
        outcome: "The release is live",
        status: "todo",
        evidence: [],
        checklist: [],
        blockers: [],
        runIds: [],
        workflow: "release",
      }),
    ).toThrow(/workflow/);
  });

  it("keeps Loop to trigger, target, input, and enabled", () => {
    expect(
      createLoopDefinition({
        id: "daily-check",
        trigger: { type: "schedule", every: "1d" },
        target: { kind: "workflow", id: "release" },
        input: { repository: "acme/app" },
        enabled: true,
      }),
    ).toMatchObject({ id: "daily-check", enabled: true });
    expect(() =>
      createLoopDefinition({
        id: "daily-check",
        trigger: { type: "schedule", every: "1d" },
        target: { kind: "workflow", id: "release" },
        input: {},
        enabled: true,
        health: "healthy",
      }),
    ).toThrow(/health/);
  });

  it.each(["workflow", "capability", "pipeline", "agent"] as const)(
    "allows a Loop to target a %s",
    (kind) => {
      expect(
        createLoopDefinition({
          id: `scheduled-${kind}`,
          trigger: { type: "schedule", every: "1h" },
          target: { kind, id: `${kind}-one` },
          input: {},
          enabled: true,
        }).target,
      ).toEqual({ kind, id: `${kind}-one` });
    },
  );

  it("calculates the next interval boundary for a scheduled Loop", () => {
    expect(
      nextLoopRunAt(
        { type: "schedule", every: "15m" },
        new Date("2026-08-19T12:07:00.000Z"),
      ),
    ).toBe("2026-08-19T12:15:00.000Z");
  });

  it("calculates the next preferred local time for a daily Loop", () => {
    expect(
      nextLoopRunAt(
        {
          type: "schedule",
          every: "1d",
          at: { time: "09:30", timezone: "Asia/Jerusalem" },
        },
        new Date("2026-08-19T07:00:00.000Z"),
      ),
    ).toBe("2026-08-20T06:30:00.000Z");
  });

  it("models AgentState as Agent-owned continuation only", () => {
    expect(
      createAgentState({
        version: 1,
        agent: "operations-agent",
        revision: 3,
        cursor: "run-42",
        summary: "Waiting for the deployment result.",
        data: { deploymentId: "dep-1" },
        updatedAt: "2026-08-19T00:00:00.000Z",
      }),
    ).toMatchObject({ agent: "operations-agent", revision: 3 });

    expect(() =>
      createAgentState({
        version: 1,
        agent: "operations-agent",
        revision: 0,
        cursor: "",
        summary: "",
        data: {},
        updatedAt: "2026-08-19T00:00:00.000Z",
        schedule: "1h",
      }),
    ).toThrow(/schedule/);
  });

  it("records the Agent used by a Run and has no Implementation reference", () => {
    const run = createRun({
      id: "run-1",
      status: "succeeded",
      target: { kind: "workflow", id: "release" },
      agent: "developer",
      startedAt: "2026-07-24T00:00:00.000Z",
      finishedAt: "2026-07-24T00:01:00.000Z",
    });
    expect(run).toMatchObject({ agent: "developer" });
    expect(run).not.toHaveProperty("execution");
    expect(() =>
      createRun({
        id: "run-2",
        status: "running",
        target: { kind: "capability", id: "inspect" },
        agent: "kody",
        startedAt: "2026-07-24T00:00:00.000Z",
        implementation: "legacy",
      }),
    ).toThrow(/implementation/);
  });
});
