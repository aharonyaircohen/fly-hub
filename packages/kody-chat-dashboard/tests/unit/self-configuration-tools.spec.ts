import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSelfConfigurationTools } from "../../app/api/kody/chat/tools/self-configuration-tools";

const capability = {
  slug: "ci-watch",
  instructions: "Read the default branch CI result and return a short summary.",
  contract: { execution: "agent" as const, input: {}, output: {} },
  skills: [],
  tools: [],
};

const workflow = {
  id: "daily-ci-watch",
  name: "Daily CI watch",
  agent: "kody",
  capabilities: ["ci-watch"],
  inputSchema: {},
  steps: [{ id: "inspect", capability: "ci-watch" }],
  runWithoutApproval: true,
};

const loop = {
  id: "daily-ci-watch",
  trigger: {
    type: "schedule" as const,
    every: "1d",
    at: { time: "09:00", timezone: "Asia/Jerusalem" },
  },
  target: { kind: "workflow" as const, id: "daily-ci-watch" },
  input: {},
  enabled: true,
};

const input = {
  outcome: "Check CI every morning and report failures.",
  capabilities: [capability],
  workflow,
  loop,
  testInput: {},
};

const ctx = {
  owner: "acme",
  repo: "app",
  listCapabilities: vi.fn(),
  readCapability: vi.fn(),
  saveCapability: vi.fn(),
  removeCapability: vi.fn(),
  readWorkflow: vi.fn(),
  saveWorkflow: vi.fn(),
  removeWorkflow: vi.fn(),
  readLoop: vi.fn(),
  saveLoop: vi.fn(),
  removeLoop: vi.fn(),
  runWorkflow: vi.fn(),
  listRuns: vi.fn(),
  wait: vi.fn(),
};

describe("self-configuration chat tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctx.listCapabilities.mockResolvedValue({ capabilities: [] });
    ctx.readCapability.mockResolvedValue({ error: "not_found", status: 404 });
    ctx.readWorkflow.mockResolvedValue({ error: "not_found", status: 404 });
    ctx.readLoop.mockResolvedValue({ error: "not_found", status: 404 });
    ctx.saveCapability.mockResolvedValue({ capability });
    ctx.saveWorkflow.mockResolvedValue({ workflow });
    ctx.saveLoop.mockResolvedValue({ loop });
    ctx.removeCapability.mockResolvedValue({ success: true });
    ctx.removeWorkflow.mockResolvedValue({ success: true });
    ctx.removeLoop.mockResolvedValue({ success: true });
    ctx.runWorkflow.mockResolvedValue({ ok: true, runId: "run-ci-1" });
    ctx.listRuns
      .mockResolvedValueOnce({
        runs: [{ id: "run-ci-1", status: "running" }],
      })
      .mockResolvedValueOnce({
        runs: [
          {
            id: "run-ci-1",
            status: "success",
            summary: "CI is green.",
          },
        ],
      });
    ctx.wait.mockResolvedValue(undefined);
  });

  it("applies one bundle, runs it once, and returns verified evidence", async () => {
    const tools = createSelfConfigurationTools(ctx);

    await expect(
      tools.configure_kody.execute!(input, {} as never),
    ).resolves.toMatchObject({
      ok: true,
      outcome: input.outcome,
      applied: {
        capabilities: ["ci-watch"],
        workflow: "daily-ci-watch",
        loop: "daily-ci-watch",
      },
      verification: {
        status: "success",
        runId: "run-ci-1",
        summary: "CI is green.",
      },
    });
    expect(ctx.saveCapability).toHaveBeenCalledBefore(ctx.saveWorkflow);
    expect(ctx.saveWorkflow).toHaveBeenCalledBefore(ctx.saveLoop);
    expect(ctx.runWorkflow).toHaveBeenCalledWith(
      { workflowId: "daily-ci-watch", input: {} },
      { approvedByConfiguration: true },
    );
  });

  it("rejects unresolved workflow capabilities before writing", async () => {
    const tools = createSelfConfigurationTools(ctx);
    const invalid = {
      ...input,
      capabilities: [],
      workflow: { ...workflow, capabilities: ["missing-capability"] },
    };

    await expect(
      tools.configure_kody.execute!(invalid, {} as never),
    ).resolves.toMatchObject({
      error: "invalid_configuration_plan",
      issues: expect.arrayContaining([
        expect.stringContaining("missing-capability"),
      ]),
    });
    expect(ctx.saveCapability).not.toHaveBeenCalled();
    expect(ctx.saveWorkflow).not.toHaveBeenCalled();
  });

  it("rolls back every applied change when a later save fails", async () => {
    ctx.saveLoop.mockResolvedValue({
      error: "invalid_loop",
      message: "Invalid schedule",
    });
    const tools = createSelfConfigurationTools(ctx);

    await expect(
      tools.configure_kody.execute!(input, {} as never),
    ).resolves.toMatchObject({
      error: "configuration_apply_failed",
      message: "Invalid schedule",
      rollback: { ok: true },
    });
    expect(ctx.removeWorkflow).toHaveBeenCalledWith("daily-ci-watch");
    expect(ctx.removeCapability).toHaveBeenCalledWith("ci-watch");
    expect(ctx.runWorkflow).not.toHaveBeenCalled();
  });

  it("does not claim success when the first run has not finished", async () => {
    ctx.listRuns.mockReset();
    ctx.listRuns.mockResolvedValue({
      runs: [{ id: "run-ci-1", status: "running" }],
    });
    const tools = createSelfConfigurationTools(ctx, {
      verificationAttempts: 2,
    });

    await expect(
      tools.configure_kody.execute!(input, {} as never),
    ).resolves.toMatchObject({
      ok: false,
      applied: { workflow: "daily-ci-watch" },
      verification: { status: "running", runId: "run-ci-1" },
    });
  });

  it("updates deterministic ids instead of creating duplicate configuration", async () => {
    ctx.readCapability.mockResolvedValue({ capability });
    ctx.readWorkflow.mockResolvedValue({ workflow });
    ctx.readLoop.mockResolvedValue({ loop });
    const tools = createSelfConfigurationTools(ctx);

    await tools.configure_kody.execute!(input, {} as never);

    expect(ctx.saveCapability).toHaveBeenCalledOnce();
    expect(ctx.saveWorkflow).toHaveBeenCalledOnce();
    expect(ctx.saveLoop).toHaveBeenCalledOnce();
  });

  it("restores prior definitions instead of deleting them during rollback", async () => {
    ctx.readCapability.mockResolvedValue({ capability });
    ctx.readWorkflow.mockResolvedValue({ workflow });
    ctx.saveLoop.mockResolvedValue({ error: "invalid_loop" });
    const tools = createSelfConfigurationTools(ctx);

    await tools.configure_kody.execute!(input, {} as never);

    expect(ctx.removeCapability).not.toHaveBeenCalled();
    expect(ctx.removeWorkflow).not.toHaveBeenCalled();
    expect(ctx.saveCapability).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: "ci-watch" }),
    );
    expect(ctx.saveWorkflow).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "daily-ci-watch" }),
    );
  });
});
