import { describe, expect, it, vi } from "vitest";

import {
  dispatchApprovedAgencyWorkflow,
  prepareApprovedAgencyExecution,
} from "../../src/dashboard/features/agency/server/approved-agency-workflow";

const execution = {
  workflowId: "ci-repair",
  input: { branch: "main", ciRunId: 123 },
  activations: [{ kind: "solution" as const, id: "ci-repair" }],
};

function services(overrides: Record<string, unknown> = {}) {
  return {
    loadWorkflow: vi.fn(async () => ({
      workflow: { id: "ci-repair", inputSchema: {} } as never,
    })),
    validateDefinition: vi.fn(() => []),
    validateInput: vi.fn(() => []),
    dispatch: vi.fn(async (request: { requestId: string }) => ({
      requestId: request.requestId,
      acceptedAt: "2026-08-13T00:00:00.000Z",
    })),
    activate: vi.fn(async () => ({
      configPatch: { activeWorkflows: ["ci-repair"] },
    })),
    ...overrides,
  };
}

describe("approved Agency Workflow dispatch", () => {
  it("uses the Agency approval to dispatch through the Workflow service", async () => {
    const workflowServices = services();
    const prepared = await prepareApprovedAgencyExecution(
      execution,
      workflowServices.activate,
    );

    const result = await dispatchApprovedAgencyWorkflow({
      actor: "github:1",
      execution: prepared,
      runId: "run-1",
      services: workflowServices,
    });

    expect(result.runId).toBe("run-1");
    expect(workflowServices.dispatch).toHaveBeenCalledOnce();
    expect(workflowServices.activate).toHaveBeenCalledWith({
      kind: "solution",
      id: "ci-repair",
    });
    expect(workflowServices.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { type: "workflow", id: "ci-repair" },
        input: {
          ...execution.input,
          installation: {
            configPatch: { activeWorkflows: ["ci-repair"] },
          },
        },
      }),
    );
  });

  it("rejects an invalid saved Workflow input before dispatch", async () => {
    const workflowServices = services({
      validateInput: vi.fn(() => [{ path: "ciRunId", message: "Required" }]),
    });

    await expect(
      dispatchApprovedAgencyWorkflow({
        actor: "github:1",
        execution,
        runId: "run-1",
        services: workflowServices,
      }),
    ).rejects.toThrow("no longer valid");
    expect(workflowServices.dispatch).not.toHaveBeenCalled();
  });

  it("keeps an empty installation envelope when activations are already local", async () => {
    const prepared = await prepareApprovedAgencyExecution(
      execution,
      vi.fn(async () => ({})),
    );

    expect(prepared.input).toEqual({
      ...execution.input,
      installation: { configPatch: {} },
    });
  });

  it("delivers prepared maintainer files through the Constructor Workflow", async () => {
    const prepared = await prepareApprovedAgencyExecution(
      execution,
      vi.fn(async () => ({
        configPatch: { activeWorkflows: ["web-release"] },
        files: [
          {
            path: ".kody-engine/definitions/loops/daily-web-release-loop/loop.json",
            content: '{"id":"daily-web-release-loop"}\n',
          },
        ],
      })),
    );

    expect(prepared.input.installation).toEqual({
      configPatch: { activeWorkflows: ["web-release"] },
      files: [
        {
          path: ".kody-engine/definitions/loops/daily-web-release-loop/loop.json",
          content: '{"id":"daily-web-release-loop"}\n',
        },
      ],
    });
  });

  it("propagates a dispatch failure for the route to sanitize", async () => {
    const workflowServices = services({
      dispatch: vi.fn(async () => {
        throw new Error("secret provider response");
      }),
    });

    await expect(
      dispatchApprovedAgencyWorkflow({
        actor: "github:1",
        execution,
        runId: "run-1",
        services: workflowServices,
      }),
    ).rejects.toThrow("secret provider response");
  });
});
