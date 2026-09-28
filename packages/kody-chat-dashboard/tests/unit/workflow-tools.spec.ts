import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkflowTools } from "../../app/api/kody/chat/tools/workflow-tools";

const ctx = {
  owner: "acme",
  repo: "app",
  listWorkflows: vi.fn(),
  readWorkflow: vi.fn(),
  saveWorkflow: vi.fn(),
  removeWorkflow: vi.fn(),
  runWorkflow: vi.fn(),
};

describe("workflow chat tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctx.listWorkflows.mockResolvedValue({
      workflows: [{ id: "documentation-agency" }],
    });
    ctx.readWorkflow.mockResolvedValue({
      workflow: { id: "documentation-agency" },
    });
    ctx.saveWorkflow.mockResolvedValue({
      workflow: { id: "documentation-agency" },
    });
    ctx.removeWorkflow.mockResolvedValue({ success: true });
    ctx.runWorkflow.mockResolvedValue({
      ok: true,
      workflow: "documentation-agency",
      runId: "run-docs-1",
    });
  });

  it("lists active workflows through the workflow API", async () => {
    const tools = createWorkflowTools(ctx);

    await expect(
      tools.list_workflows.execute!({}, {} as never),
    ).resolves.toMatchObject({
      workflows: [{ id: "documentation-agency" }],
    });
    expect(ctx.listWorkflows).toHaveBeenCalledOnce();
  });

  it("reads one repository or Store workflow definition before selection", async () => {
    const tools = createWorkflowTools(ctx);

    await expect(
      tools.read_workflow.execute!(
        { workflowId: "documentation-agency" },
        {} as never,
      ),
    ).resolves.toMatchObject({
      workflow: { id: "documentation-agency" },
    });
    expect(ctx.readWorkflow).toHaveBeenCalledWith("documentation-agency");
  });

  it("runs any selected workflow without exposing approval as model input", async () => {
    const tools = createWorkflowTools(ctx);

    await expect(
      tools.run_workflow.execute!(
        {
          workflowId: "documentation-agency",
          input: { issue: 42 },
        },
        {} as never,
      ),
    ).resolves.toMatchObject({
      ok: true,
      workflow: "documentation-agency",
      runId: "run-docs-1",
    });
    expect(ctx.runWorkflow).toHaveBeenCalledWith({
      workflowId: "documentation-agency",
      input: { issue: 42 },
    });
  });

  it("saves and removes workflows through the workflow API", async () => {
    const tools = createWorkflowTools(ctx);
    const workflow = {
      id: "documentation-agency",
      name: "Documentation Agency",
      agent: "writer",
      capabilities: ["draft-docs"],
      inputSchema: {},
      steps: [{ id: "draft", capability: "draft-docs" }],
      report: {
        type: "documentation-review",
        owner: "documentation-agency",
        slug: "documentation-review",
      },
      runWithoutApproval: false,
    };

    await expect(
      tools.create_or_update_workflow.execute!(workflow, {} as never),
    ).resolves.toMatchObject({
      workflow: { id: "documentation-agency" },
    });
    expect(ctx.saveWorkflow).toHaveBeenCalledWith(workflow);

    await expect(
      tools.remove_workflow.execute!(
        { workflowId: "documentation-agency" },
        {} as never,
      ),
    ).resolves.toEqual({ success: true });
    expect(ctx.removeWorkflow).toHaveBeenCalledWith("documentation-agency");
  });

  it("requires a complete create input or an existing workflow id", () => {
    const schema = createWorkflowTools(ctx).create_or_update_workflow
      .inputSchema as { safeParse(input: unknown): { success: boolean } };

    expect(schema.safeParse({}).success).toBe(false);
    expect(
      schema.safeParse({ name: "QA pass", capabilities: ["inspect"] }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ id: "documentation-agency", report: { version: 2 } })
        .success,
    ).toBe(true);
  });

  it("updates one workflow field without resending array fields", async () => {
    const tools = createWorkflowTools(ctx);
    const patch = {
      id: "documentation-agency",
      report: {
        type: "documentation-review",
        version: 1,
        owner: "documentation-agency",
        slug: "documentation-review",
        title: "Documentation Review",
      },
    };

    await expect(
      tools.create_or_update_workflow.execute!(patch, {} as never),
    ).resolves.toMatchObject({
      workflow: { id: "documentation-agency" },
    });
    expect(ctx.saveWorkflow).toHaveBeenCalledWith(patch);
  });
});
