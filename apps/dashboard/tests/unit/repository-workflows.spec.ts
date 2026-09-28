import { describe, expect, it, vi } from "vitest";

import {
  deleteRepositoryWorkflow,
  prepareRepositoryWorkflowFile,
  saveRepositoryWorkflow,
} from "@dashboard/lib/repository-workflows";

const workflow = {
  name: "Director CI Monitor",
  capabilities: ["observe-repo-ci"],
  startAt: "check-ci",
  steps: [{ id: "check-ci", capability: "observe-repo-ci" }],
  agent: "kody",
  createdAt: "2026-08-26T00:00:00Z",
  updatedAt: "2026-08-26T00:00:00Z",
};

function file(sha = "workflow-sha") {
  return {
    data: {
      type: "file",
      sha,
      content: Buffer.from(JSON.stringify(workflow)).toString("base64"),
    },
  };
}

describe("repository workflows", () => {
  it("prepares the Engine runtime file used by deferred Store activation", () => {
    const prepared = prepareRepositoryWorkflowFile(
      "director-ci-monitor",
      workflow,
    );

    expect(prepared.workflow).toEqual(workflow);
    expect(prepared.path).toBe(
      ".kody-engine/definitions/workflows/director-ci-monitor/workflow.json",
    );
    expect(JSON.parse(prepared.content)).toEqual(workflow);
    expect(prepared.content.endsWith("\n")).toBe(true);
  });

  it("writes the Workflow to the Engine runtime path", async () => {
    const createOrUpdateFileContents = vi.fn().mockResolvedValue({
      data: { content: { sha: "new" }, commit: { sha: "commit" } },
    });
    const octokit = {
      repos: {
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
        createOrUpdateFileContents,
      },
    } as never;

    await expect(
      saveRepositoryWorkflow(
        octokit,
        "acme",
        "widgets",
        "director-ci-monitor",
        workflow,
        "install workflow",
      ),
    ).resolves.toMatchObject({ workflow, created: true });
    expect(createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: ".kody-engine/definitions/workflows/director-ci-monitor/workflow.json",
        message: "install workflow",
      }),
    );
  });

  it("does not rewrite an unchanged Workflow", async () => {
    const createOrUpdateFileContents = vi.fn();
    const octokit = {
      repos: {
        getContent: vi.fn().mockResolvedValue(file()),
        createOrUpdateFileContents,
      },
    } as never;

    await expect(
      saveRepositoryWorkflow(
        octokit,
        "acme",
        "widgets",
        "director-ci-monitor",
        workflow,
        "install workflow",
      ),
    ).resolves.toMatchObject({ workflow, created: false, written: false });
    expect(createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it("deletes the exact Engine runtime file", async () => {
    const deleteFile = vi.fn().mockResolvedValue({ data: {} });
    const octokit = {
      repos: {
        getContent: vi.fn().mockResolvedValue(file()),
        deleteFile,
      },
    } as never;

    await expect(
      deleteRepositoryWorkflow(
        octokit,
        "acme",
        "widgets",
        "director-ci-monitor",
        "remove workflow",
      ),
    ).resolves.toBe(true);
    expect(deleteFile).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      path: ".kody-engine/definitions/workflows/director-ci-monitor/workflow.json",
      message: "remove workflow",
      sha: "workflow-sha",
    });
  });
});
