import { describe, expect, it, vi } from "vitest";
import {
  assessPreparedAgencyRequest,
  submitAgencyRequest,
} from "../src/agency-request-manager";

describe("Agency Request Manager", () => {
  it("deterministically approves a valid prepared Blueprint execution", async () => {
    const save = vi.fn(async () => undefined);
    const execution = {
      workflowId: "apply-strategy",
      input: { blueprintId: "healthy-ci" },
      activations: [
        { kind: "workflow" as const, id: "apply-strategy" },
        { kind: "solution" as const, id: "ci-repair" },
      ],
    };

    const result = await assessPreparedAgencyRequest("healthy-ci-request", {
      read: vi.fn(async () => ({
        slug: "healthy-ci-request",
        state: {
          phase: "blocked" as const,
          source: {
            kind: "guided-flow" as const,
            instanceId: "flow-1",
            effectId: "effect-1",
          },
          requirement: {
            outcome: "Build repository-native CI",
            success: "CI passes on the proposed commit",
          },
          questions: [],
          plan: [],
          execution,
          evidence: [],
          blockers: ["Workflow is not active"],
          related: [],
        },
      })),
      validateExecution: vi.fn(async () => ({ execution, issues: [] })),
      save,
    });

    expect(result).toMatchObject({
      kind: "ready",
      workflowId: "apply-strategy",
    });
    expect(save).toHaveBeenCalledWith(
      "healthy-ci-request",
      expect.objectContaining({
        phase: "waiting-approval",
        execution,
        blockers: [],
        plan: expect.arrayContaining([
          expect.stringContaining("apply-strategy"),
        ]),
      }),
    );
  });

  it("leaves requests without a prepared Blueprint for normal assessment", async () => {
    const save = vi.fn();
    const result = await assessPreparedAgencyRequest("custom-request", {
      read: vi.fn(async () => ({
        slug: "custom-request",
        state: {
          phase: "assessing" as const,
          source: {
            kind: "guided-flow" as const,
            instanceId: "flow-2",
            effectId: "effect-2",
          },
          requirement: { outcome: "Build a custom automation" },
          questions: [],
          plan: [],
          evidence: [],
          blockers: [],
          related: [],
        },
      })),
      validateExecution: vi.fn(),
      save,
    });

    expect(result).toEqual({ kind: "requires-reasoning" });
    expect(save).not.toHaveBeenCalled();
  });

  it("creates one assessing Todo and returns a Kody handoff", async () => {
    const create = vi.fn(async () => ({ slug: "keep-ci-healthy" }));
    const findExisting = vi.fn(async () => null);

    const result = await submitAgencyRequest(
      {
        blueprintId: "healthy-ci",
        source: {
          kind: "guided-flow",
          instanceId: "flow-1",
          effectId: "effect-1",
        },
        answers: {
          desiredOutcome: "Keep CI healthy on main",
          activation: "Whenever GitHub CI fails",
          allowedActions: "Create a pull request; do not merge",
          successCriteria: "The latest main CI run is green",
          additionalContext: "Use CI Repair when compatible",
        },
      },
      {
        create,
        findExisting,
        update: vi.fn(),
        resolveBlueprint: vi.fn(async () => ({
          blueprint: {
            id: "healthy-ci",
            version: "1.0.0",
            name: "Healthy CI",
            application: {
              workflowId: "apply-strategy",
              workflowInput: {
                waitForCi: true,
                ciTimeoutSeconds: 1800,
              },
              activate: [{ kind: "solution", id: "ci-repair" }],
            },
          } as never,
          instructions: "Inspect the repository and build native CI.",
        })),
      },
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Build Healthy CI",
        items: [
          expect.objectContaining({
            title: "Validate the request and Blueprint",
            meta: { kind: "agency-request-validation" },
          }),
          expect.objectContaining({
            title: "Prepare the repository-specific plan",
            meta: { kind: "agency-request-plan" },
          }),
          expect.objectContaining({
            title: "Activate the required automation",
            meta: { kind: "agency-request-activation" },
          }),
          expect.objectContaining({
            title: "Run the Blueprint Workflow",
            meta: { kind: "agency-request-execution" },
          }),
          expect.objectContaining({
            title: "Verify the result end to end",
            meta: { kind: "agency-request-verification" },
          }),
          expect.objectContaining({
            title: "Publish the completion report",
            meta: { kind: "agency-request-report" },
          }),
        ],
        agencyRequest: expect.objectContaining({
          phase: "assessing",
          execution: expect.objectContaining({
            workflowId: "apply-strategy",
            input: expect.objectContaining({
              waitForCi: true,
              ciTimeoutSeconds: 1800,
            }),
            activations: [
              { kind: "workflow", id: "apply-strategy" },
              { kind: "solution", id: "ci-repair" },
            ],
          }),
          related: expect.arrayContaining([
            { kind: "strategy", id: "healthy-ci" },
          ]),
        }),
      }),
    );
    expect(result).toMatchObject({
      created: true,
      todoSlug: "keep-ci-healthy",
      handoff: { type: "kody" },
    });
    expect(result.handoff.message).toContain("keep-ci-healthy");
  });

  it("turns Create Blueprint intake into an explicit Blueprint creation job", async () => {
    const create = vi.fn(async () => ({ slug: "create-release-blueprint" }));

    const result = await submitAgencyRequest(
      {
        source: {
          kind: "guided-flow",
          instanceId: "flow-create-1",
          effectId: "effect-create-1",
          flowId: "create-blueprint",
        },
        answers: {
          desiredOutcome: "Release web applications safely",
          activation: "On demand",
          allowedActions: "Create a pull request; do not merge",
          successCriteria: "The Blueprint installs and passes its live test",
        },
      },
      {
        create,
        findExisting: vi.fn(async () => null),
        update: vi.fn(),
      },
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Create Blueprint: Release web applications safely",
        description: expect.stringContaining("reusable Store Blueprint"),
      }),
    );
    expect(result.handoff.message).toContain(
      "Create and publish a reusable Store Strategy Blueprint",
    );
  });

  it("reuses and resets the repository Todo owned by the same Blueprint", async () => {
    const create = vi.fn();
    const update = vi.fn(async () => ({ slug: "healthy-ci" }));
    const findExisting = vi.fn(async () => ({ slug: "healthy-ci" }));

    const result = await submitAgencyRequest(
      {
        blueprintId: "healthy-ci",
        source: {
          kind: "store-blueprint",
          blueprintId: "healthy-ci",
          requestId: "new-click",
        },
        answers: {},
      },
      {
        create,
        update,
        findExisting,
        resolveBlueprint: vi.fn(async () => ({
          blueprint: {
            schemaVersion: 1,
            kind: "strategy-blueprint",
            id: "healthy-ci",
            version: "1.1.0",
            name: "Healthy CI",
            outcome: "Build repository-native CI and keep it passing",
            instructions: "instructions.md",
            constraints: ["Open a pull request; do not merge it"],
            application: {
              workflowId: "apply-strategy",
              workflowInput: { waitForCi: true },
              activate: [{ kind: "solution", id: "ci-repair" }],
            },
            verification: { criteria: ["Repository CI passes"] },
            compatibility: {
              repositoryTypes: ["javascript"],
              providers: ["github-actions"],
            },
          },
          instructions: "Inspect the repository and build native CI.",
        })),
      },
    );

    expect(findExisting).toHaveBeenCalledWith({
      blueprintId: "healthy-ci",
      source: expect.objectContaining({ requestId: "new-click" }),
    });
    expect(update).toHaveBeenCalledWith(
      "healthy-ci",
      expect.objectContaining({
        agencyRequest: expect.objectContaining({
          phase: "waiting-approval",
          source: expect.objectContaining({ requestId: "new-click" }),
          evidence: [],
          blockers: [],
          related: expect.not.arrayContaining([
            expect.objectContaining({ kind: "run" }),
          ]),
        }),
        items: expect.arrayContaining([
          expect.objectContaining({ completed: false }),
        ]),
      }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ created: false, todoSlug: "healthy-ci" });
  });

  it("turns a Store Blueprint click into an authorized ready request", async () => {
    const create = vi.fn(async () => ({ slug: "build-healthy-ci" }));
    const result = await submitAgencyRequest(
      {
        blueprintId: "healthy-ci",
        source: {
          kind: "store-blueprint",
          blueprintId: "healthy-ci",
          requestId: "request-1",
        },
        answers: {},
      },
      {
        create,
        findExisting: vi.fn(async () => null),
        update: vi.fn(),
        resolveBlueprint: vi.fn(async () => ({
          blueprint: {
            schemaVersion: 1,
            kind: "strategy-blueprint",
            id: "healthy-ci",
            version: "1.0.0",
            name: "Healthy CI",
            outcome: "Build repository-native CI and keep it passing",
            instructions: "instructions.md",
            constraints: ["Open a pull request; do not merge it"],
            application: {
              workflowId: "apply-strategy",
              workflowInput: { waitForCi: true },
              activate: [{ kind: "solution", id: "ci-repair" }],
            },
            verification: { criteria: ["Repository CI passes"] },
            compatibility: {
              repositoryTypes: ["javascript"],
              providers: ["github-actions"],
            },
          },
          instructions: "Inspect the repository and build native CI.",
        })),
      },
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Build Healthy CI",
        agencyRequest: expect.objectContaining({
          phase: "waiting-approval",
          source: {
            kind: "store-blueprint",
            blueprintId: "healthy-ci",
            requestId: "request-1",
          },
          requirement: expect.objectContaining({
            outcome: "Build repository-native CI and keep it passing",
            permissions: "Open a pull request; do not merge it",
            success: "Repository CI passes",
          }),
        }),
      }),
    );
    expect(result.handoff.message).toContain("already authorized");
    expect(result.handoff.message).not.toContain("present one approval action");
  });

  it("rejects an unavailable requested Blueprint", async () => {
    await expect(
      submitAgencyRequest(
        {
          blueprintId: "missing",
          source: {
            kind: "guided-flow",
            instanceId: "flow-1",
            effectId: "effect-1",
          },
          answers: { desiredOutcome: "Keep CI healthy" },
        },
        {
          create: vi.fn(),
          findExisting: vi.fn(async () => null),
          update: vi.fn(),
          resolveBlueprint: vi.fn(async () => null),
        },
      ),
    ).rejects.toThrow(/Blueprint.*unavailable/i);
  });

  it("returns the existing Todo when a completion effect is retried", async () => {
    const create = vi.fn();
    const result = await submitAgencyRequest(
      {
        source: {
          kind: "guided-flow",
          instanceId: "flow-1",
          effectId: "effect-1",
        },
        answers: { desiredOutcome: "Keep CI healthy" },
      },
      {
        create,
        findExisting: vi.fn(async () => ({ slug: "keep-ci-healthy" })),
        update: vi.fn(async (slug) => ({ slug })),
      },
    );

    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      created: false,
      todoSlug: "keep-ci-healthy",
    });
  });

  it("refuses a request without an outcome", async () => {
    await expect(
      submitAgencyRequest(
        {
          source: {
            kind: "guided-flow",
            instanceId: "flow-1",
            effectId: "effect-1",
          },
          answers: {},
        },
        {
          create: vi.fn(),
          findExisting: vi.fn(async () => null),
          update: vi.fn(),
        },
      ),
    ).rejects.toThrow(/outcome/i);
  });
});
