import { describe, expect, it, vi } from "vitest";

import {
  buildKodyWorkflowDispatchInputs,
  parseWorkflowDispatchInputNames,
} from "@dashboard/lib/kody-workflow-dispatch";

const executableWorkflow = `
name: kody
on:
  workflow_dispatch:
    inputs:
      issue_number:
        type: string
        default: ""
      message:
        type: string
        default: ""
      implementation:
        type: string
        default: ""
      storeRepoUrl:
        type: string
        default: ""
      storeRef:
        type: string
        default: ""
`;

function octokitWithWorkflow(workflow: string) {
  return {
    rest: {
      repos: {
        getContent: vi.fn(async () => ({
          data: {
            type: "file",
            encoding: "base64",
            content: Buffer.from(workflow, "utf8").toString("base64"),
          },
        })),
      },
    },
  };
}

describe("kody workflow dispatch input mapping", () => {
  it("parses workflow_dispatch input names from kody.yml", () => {
    expect(parseWorkflowDispatchInputNames(executableWorkflow)).toEqual(
      new Set([
        "issue_number",
        "message",
        "implementation",
        "storeRepoUrl",
        "storeRef",
      ]),
    );
  });

  it("uses implementation when the target workflow declares it", async () => {
    const octokit = octokitWithWorkflow(executableWorkflow);

    await expect(
      buildKodyWorkflowDispatchInputs(octokit, {
        owner: "test-owner",
        repo: "test-repo",
        ref: "main",
        action: "loop-manager",
        message: "web-release",
        storeRepoUrl: "https://github.com/acme/kody-store",
        storeRef: "main",
      }),
    ).resolves.toEqual({
      implementation: "loop-manager",
      message: "web-release",
      storeRepoUrl: "https://github.com/acme/kody-store",
      storeRef: "main",
    });
  });

  it("falls back to implementation when workflow inputs cannot be read", async () => {
    const octokit = {
      rest: {
        repos: {
          getContent: vi.fn(async () => {
            throw new Error("not available");
          }),
        },
      },
    };

    await expect(
      buildKodyWorkflowDispatchInputs(octokit, {
        owner: "test-owner",
        repo: "test-repo",
        ref: "main",
        action: "repo-graph",
      }),
    ).resolves.toEqual({ implementation: "repo-graph" });
  });

  it("forwards the generic request id when the workflow declares it", async () => {
    const octokit = octokitWithWorkflow(`
on:
  workflow_dispatch:
    inputs:
      requestId:
        type: string
      runRequest:
        type: string
`);
    const executionRequest = {
      requestId: "run-quality-1",
      target: { type: "workflow" as const, id: "quality-run" },
      intent: "run" as const,
      source: "dashboard" as const,
    };

    await expect(
      buildKodyWorkflowDispatchInputs(octokit, {
        owner: "test-owner",
        repo: "test-repo",
        ref: "main",
        requestId: executionRequest.requestId,
        executionRequest,
      }),
    ).resolves.toEqual({
      requestId: "run-quality-1",
      runRequest: JSON.stringify(executionRequest),
    });
  });

  it("uses the transport-safe request input when the workflow declares it", async () => {
    const octokit = octokitWithWorkflow(`
on:
  workflow_dispatch:
    inputs:
      requestId:
        type: string
      runRequestBase64:
        type: string
`);
    const executionRequest = {
      requestId: "run-quality-1",
      target: { type: "workflow" as const, id: "quality-run" },
      intent: "run" as const,
      source: "dashboard" as const,
      input: {
        journeys: [{ slug: "chat", actions: [{ slug: "send" }] }],
      },
    };

    const inputs = await buildKodyWorkflowDispatchInputs(octokit, {
      owner: "test-owner",
      repo: "test-repo",
      ref: "main",
      requestId: executionRequest.requestId,
      executionRequest,
    });

    expect(inputs).toEqual({
      requestId: "run-quality-1",
      runRequestBase64: Buffer.from(
        JSON.stringify(executionRequest),
        "utf8",
      ).toString("base64"),
    });
    expect(JSON.parse(Buffer.from(inputs.runRequestBase64!, "base64").toString("utf8"))).toEqual(
      executionRequest,
    );
  });

  it("shares cached workflow input reads for repeated dispatches", async () => {
    const octokit = octokitWithWorkflow(executableWorkflow);

    await buildKodyWorkflowDispatchInputs(
      octokit,
      { owner: "cache-owner", repo: "cache-repo", ref: "main", action: "run" },
      { cache: true },
    );
    await buildKodyWorkflowDispatchInputs(
      octokit,
      { owner: "cache-owner", repo: "cache-repo", ref: "main", action: "run" },
      { cache: true },
    );

    expect(octokit.rest.repos.getContent).toHaveBeenCalledTimes(1);
  });
});
