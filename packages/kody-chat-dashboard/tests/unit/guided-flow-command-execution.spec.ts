import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeGuidedFlowCommand,
  refreshGuidedFlowCommand,
} from "../../app/api/kody/guided-flows/command-execution";

function request(): NextRequest {
  return new NextRequest("https://dashboard.test/api/kody/guided-flows", {
    headers: {
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
      "x-kody-token": "secret",
      "transfer-encoding": "chunked",
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Guided Flow command execution", () => {
  it("forwards the raw command to the shared Chat operation boundary", async () => {
    const fetchMock = vi.fn<
      (input: URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      Response.json({
        handled: true,
        command: "/init",
        result: {
          status: "completed",
          summary: "Engine ready",
          secret: "drop",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeGuidedFlowCommand(request(), "/init", "mutation-1"),
    ).resolves.toEqual({ status: "completed", summary: "Engine ready" });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://dashboard.test/api/kody/chat/operations"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ input: "/init" }),
      }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("x-kody-idempotency-key")).toBe("mutation-1");
    expect(headers.get("x-kody-token")).toBe("secret");
    expect(headers.has("transfer-encoding")).toBe(false);
  });

  it("rejects commands that the shared boundary does not execute", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ handled: false })),
    );

    await expect(
      executeGuidedFlowCommand(request(), "/review", "mutation-1"),
    ).rejects.toMatchObject({
      code: "command_not_executable",
      status: 400,
    });
  });

  it("preserves a command result that needs attention", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          handled: true,
          command: "/init",
          result: {
            status: "needs_attention",
            summary: "Webhook FAILED — Not Found (HTTP 404).",
            approvalChallenge: "signed-challenge",
            workflowInput: { resourceId: "resource-1" },
          },
        }),
      ),
    );

    await expect(
      executeGuidedFlowCommand(request(), "/init", "mutation-1"),
    ).resolves.toEqual({
      status: "needs_attention",
      summary: "Webhook FAILED — Not Found (HTTP 404).",
      approvalChallenge: "signed-challenge",
      workflowInput: { resourceId: "resource-1" },
    });
  });

  it("forwards Guided Flow data for workflow commands", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        handled: true,
        command: "/run-workflow",
        result: { status: "completed", summary: "Workflow accepted" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await executeGuidedFlowCommand(
      request(),
      "/run-workflow custom-workflow",
      "mutation-2",
      {
        flowData: { resourceId: "resource-1", assetPath: "input.bin" },
        previousResult: { approvalChallenge: "challenge" },
        actionId: "approve",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://dashboard.test/api/kody/chat/operations"),
      expect.objectContaining({
        body: JSON.stringify({
          input: "/run-workflow custom-workflow",
          context: {
            flowData: { resourceId: "resource-1", assetPath: "input.bin" },
            previousResult: { approvalChallenge: "challenge" },
            actionId: "approve",
          },
        }),
      }),
    );
  });

  it("keeps an opted-in workflow command running until its persisted run finishes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          handled: true,
          result: {
            status: "completed",
            summary: "Workflow accepted",
            workflowId: "review-lesson",
            runId: "run-1",
          },
        }),
      ),
    );

    await expect(
      executeGuidedFlowCommand(
        request(),
        "/run-workflow review-lesson",
        "mutation-3",
        undefined,
        true,
      ),
    ).resolves.toMatchObject({
      status: "running",
      workflowId: "review-lesson",
      runId: "run-1",
    });
  });

  it("turns the persisted terminal workflow state into command completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ run: { state: { status: "done" } } }),
      ),
    );

    await expect(
      refreshGuidedFlowCommand(request(), {
        status: "running",
        workflowId: "review-lesson",
        runId: "run-1",
      }),
    ).resolves.toEqual({
      status: "completed",
      summary: "Workflow completed.",
      workflowId: "review-lesson",
      runId: "run-1",
    });
  });

  it("shows a persisted workflow blocker instead of completing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          run: { state: { status: "blocked", blocker: "Missing lesson" } },
        }),
      ),
    );

    await expect(
      refreshGuidedFlowCommand(request(), {
        status: "running",
        workflowId: "review-lesson",
        runId: "run-1",
      }),
    ).resolves.toMatchObject({
      status: "needs_attention",
      summary: "Workflow blocked: Missing lesson",
    });
  });
});
