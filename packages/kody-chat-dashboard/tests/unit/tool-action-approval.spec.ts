import { describe, expect, it, vi } from "vitest";

import {
  approvedToolActionContent,
  createToolActionApproval,
  readToolActionApproval,
  runApprovedToolAction,
  stageToolsForApproval,
} from "../../app/api/kody/chat/tools/tool-action-approval";

const context = {
  owner: "aharonyaircohen",
  repo: "Kody-Engine-Tester",
  actorId: "42",
};

describe("tool action approval", () => {
  it("stages supported mutations instead of executing them immediately", async () => {
    const execute = vi.fn();
    const tools = stageToolsForApproval(
      {
        create_chore: { description: "Create a chore", execute },
        list_workflows: { execute: vi.fn() },
      },
      { secret: "github-token", context },
    ) as Record<string, { execute(input: unknown): Promise<unknown> }>;

    const result = await tools.create_chore.execute({ title: "Safe action" });

    expect(result).toMatchObject({
      action: "render_view",
      rendererSlug: "approval-card",
    });
    expect((result as { data?: { body?: string } }).data?.body).toBe(
      "Approve to run this exact saved action, or cancel to leave everything unchanged.",
    );
    expect(execute).not.toHaveBeenCalled();
    expect(tools.list_workflows).toBeDefined();
  });

  it("passes verified decision context through the staged approval boundary", async () => {
    const tools = stageToolsForApproval(
      { configure_kody: { execute: vi.fn() } },
      {
        secret: "github-token",
        context,
        decisionContext: {
          currentState:
            "PR #24 is failing because the branch cannot be written to.",
          whyNow:
            "The correction flow is paused until the branch access is fixed.",
          recommendedAction:
            "Rerunning updates the same PR branch and creates no new pull request.",
          cancelChoice: "Cancelling leaves PR #24 unchanged.",
          recommendation: "Rerun on the same branch.",
          tradeoff: "The existing review history is preserved.",
        },
      },
    ) as Record<string, { execute(input: unknown): Promise<unknown> }>;

    const result = await tools.configure_kody.execute({ slug: "ci-watch" });
    const body = String(
      (result as { data?: { body?: string } }).data?.body ?? "",
    );

    expect(body).toContain("**Current:** PR #24 is failing");
    expect(body).toContain(
      "**Approving will:** Rerunning updates the same PR branch and creates no new pull request.",
    );
    expect(body).toContain(
      "**Cancelling will:** Cancelling leaves PR #24 unchanged.",
    );
    expect(body).not.toMatch(/kody_run_issue|configure_kody/);
  });

  it.each([
    "create_or_update_capability",
    "copy_capability",
    "configure_kody",
    "guided_flow_create",
    "create_app",
    "manage_app",
    "update_app",
  ])("protects %s with the same exact-action approval", async (toolName) => {
    const execute = vi.fn();
    const tools = stageToolsForApproval(
      { [toolName]: { execute } },
      { secret: "github-token", context },
    ) as Record<string, { execute(input: unknown): Promise<unknown> }>;

    const result = await tools[toolName]!.execute({ slug: "ci-watch" });

    expect(result).toMatchObject({
      action: "render_view",
      rendererSlug: "approval-card",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs the exact server-bound action after approval", async () => {
    const directive = createToolActionApproval({
      secret: "github-token",
      context,
      toolName: "create_chore",
      input: { title: "Verify approvals", requirements: ["Create it once"] },
      title: "Create Verify approvals?",
      body: "Create it once",
      now: 1_000,
    });
    const latestUserText = `<view_result>${JSON.stringify({
      kind: "view_result",
      view: "renderer",
      viewId: directive.id,
      rendererSlug: "approval-card",
      actionId: "approve",
    })}</view_result>`;

    const approval = readToolActionApproval(latestUserText, {
      secret: "github-token",
      context,
      now: 1_001,
    });
    const execute = vi.fn().mockResolvedValue({ number: 3997 });

    await expect(
      runApprovedToolAction(approval, { create_chore: { execute } }),
    ).resolves.toEqual({
      action: "approved",
      toolName: "create_chore",
      input: { title: "Verify approvals", requirements: ["Create it once"] },
      output: { number: 3997 },
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      title: "Verify approvals",
      requirements: ["Create it once"],
    });
  });

  it("rejects a changed action", () => {
    const directive = createToolActionApproval({
      secret: "github-token",
      context,
      toolName: "create_chore",
      input: { title: "Original" },
      title: "Create Original?",
      now: 1_000,
    });
    const changedId = `${directive.id.slice(0, -1)}${directive.id.endsWith("a") ? "b" : "a"}`;
    const latestUserText = `<view_result>${JSON.stringify({
      kind: "view_result",
      view: "renderer",
      viewId: changedId,
      rendererSlug: "approval-card",
      actionId: "approve",
    })}</view_result>`;

    expect(
      readToolActionApproval(latestUserText, {
        secret: "github-token",
        context,
        now: 1_001,
      }),
    ).toBeNull();
  });

  it("does not execute a cancelled action", async () => {
    const directive = createToolActionApproval({
      secret: "github-token",
      context,
      toolName: "create_kody_agent",
      input: { title: "Reviewer" },
      title: "Create Reviewer?",
      now: 1_000,
    });
    const latestUserText = `<view_result>${JSON.stringify({
      kind: "view_result",
      view: "renderer",
      viewId: directive.id,
      rendererSlug: "approval-card",
      actionId: "cancel",
    })}</view_result>`;
    const approval = readToolActionApproval(latestUserText, {
      secret: "github-token",
      context,
      now: 1_001,
    });
    const execute = vi.fn();

    await expect(
      runApprovedToolAction(approval, { create_kody_agent: { execute } }),
    ).resolves.toEqual({ action: "cancelled" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns an action error instead of failing the approval request", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("GitHub unavailable"));

    await expect(
      runApprovedToolAction(
        {
          action: "approve",
          toolName: "create_chore",
          input: { title: "Safe failure" },
        },
        { create_chore: { execute } },
      ),
    ).resolves.toMatchObject({
      action: "approved",
      output: { error: "GitHub unavailable" },
    });
  });

  it("shows the verified first-run evidence after configuration approval", () => {
    expect(
      approvedToolActionContent({
        toolName: "configure_kody",
        output: {
          ok: true,
          verification: {
            status: "success",
            runId: "run-ci-1",
            summary: "CI is green.",
          },
        },
      }),
    ).toBe(
      "Configuration applied and verified. First run run-ci-1 succeeded: CI is green.",
    );
  });

  it("describes a completed cross-repository capability copy", () => {
    expect(
      approvedToolActionContent({
        toolName: "copy_capability",
        output: {
          copied: true,
          slug: "prepare-facebook-post",
          source: "acme/source",
          target: "acme/target",
        },
      }),
    ).toBe(
      "Copied prepare-facebook-post from acme/source to acme/target and verified the saved target.",
    );
  });

  it("makes an overwrite explicit in the cross-repository approval", async () => {
    const tools = stageToolsForApproval(
      { copy_capability: { execute: vi.fn() } },
      { secret: "github-token", context },
    ) as Record<string, { execute(input: unknown): Promise<unknown> }>;

    const result = await tools.copy_capability.execute({
      source: { owner: "acme", repo: "source" },
      target: { owner: "acme", repo: "target" },
      slug: "prepare-facebook-post",
      overwrite: true,
    });

    expect(JSON.stringify(result)).toContain(
      "Replace prepare-facebook-post from acme/source to acme/target?",
    );
  });

  it("renders complete decision context without exposing internal tool names", () => {
    const directive = createToolActionApproval({
      secret: "github-token",
      context,
      toolName: "configure_kody",
      input: { slug: "ci-watch" },
      title: "Rerun the existing issue to fix the branch access failure?",
      decisionContext: {
        currentState:
          "PR #24 is failing because the branch cannot be written to with the current token.",
        whyNow:
          "The correction flow is paused and the pull request will stay red until the write access is fixed.",
        recommendedAction:
          "Rerunning updates the same PR branch and creates no new pull request.",
        cancelChoice:
          "Stopping leaves PR #24 unchanged so you can fix access before trying again.",
        recommendation: "Rerun on the same branch.",
        tradeoff:
          "Keeping the branch preserves its existing review history; starting over would lose that context.",
      },
      now: 1_000,
    });

    const body = String((directive.data as { body?: string }).body ?? "");
    expect(body).toContain("**Current:** PR #24 is failing");
    expect(body).toContain("**Why:** The correction flow is paused");
    expect(body).toContain(
      "**Approving will:** Rerunning updates the same PR branch and creates no new pull request.",
    );
    expect(body).toContain(
      "**Cancelling will:** Stopping leaves PR #24 unchanged",
    );
    expect(body).toContain("**Recommendation:** Rerun on the same branch.");
    expect(body).toContain("**Tradeoff:** Keeping the branch preserves");
    expect(directive.data.title).not.toMatch(/kody_run_issue|configure_kody/);
  });

  it("keeps concise confirmations short when no decision context is supplied", () => {
    const directive = createToolActionApproval({
      secret: "github-token",
      context,
      toolName: "create_chore",
      input: { title: "Refresh dependencies" },
      title: "Create task Refresh dependencies?",
      now: 1_000,
    });

    const body = String((directive.data as { body?: string }).body ?? "");
    expect(body.length).toBeLessThan(200);
    expect(body).toContain("Approve");
  });
});
