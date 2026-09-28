import { describe, expect, it, vi } from "vitest";

import { createWorkflowApiClient } from "../../app/api/kody/chat/tools/workflow-api-client";

const request = {
  url: "https://dash.test/api/kody/chat/kody",
  headers: new Headers({
    "x-kody-owner": "acme",
    "x-kody-repo": "app",
    authorization: "Bearer user-token",
    "content-length": "999",
  }),
};
const approval = {
  owner: "acme",
  repo: "app",
  latestUserText: null,
};

describe("workflow API client", () => {
  it("returns workflow validation issues to the chat agent", async () => {
    const issues = [
      {
        code: "undeclared_capability",
        path: "steps[0].capability",
        message: "Capability ci-health-check is not declared.",
      },
    ];
    const client = createWorkflowApiClient({
      request,
      approval,
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "invalid_workflow",
            message: "Workflow is invalid and was not dispatched.",
            issues,
          }),
          { status: 409 },
        ),
      ),
    });

    await expect(
      client.run({ workflowId: "ci-repair", input: {} }),
    ).resolves.toMatchObject({
      error: "invalid_workflow",
      status: 409,
      issues,
    });
  });

  it("forwards repository auth to the real workflow list and detail routes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ workflows: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ workflow: { id: "docs" } }), {
          status: 200,
        }),
      );
    const client = createWorkflowApiClient({
      request,
      approval,
      fetchImpl,
    });

    await client.list();
    await client.read("documentation-agency", true);

    expect(fetchImpl.mock.calls[0]![0].toString()).toBe(
      "https://dash.test/api/kody/company/workflows",
    );
    expect(fetchImpl.mock.calls[1]![0].toString()).toBe(
      "https://dash.test/api/kody/company/workflows/documentation-agency?includeStore=true",
    );
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer user-token");
    expect(headers.get("x-kody-owner")).toBe("acme");
    expect(headers.has("content-length")).toBe(false);
  });

  it("turns approval-required into a bound card, then sends approved only after its click", async () => {
    const firstFetch = vi.fn<typeof fetch>(async (_input, _init) => {
      return new Response(
        JSON.stringify({
          error: "approval_required",
          approvalToken: "server.challenge",
        }),
        { status: 409 },
      );
    });
    const firstClient = createWorkflowApiClient({
      request,
      approval,
      fetchImpl: firstFetch,
    });
    const command = {
      workflowId: "documentation-agency",
      input: { issue: 42 },
    };

    const directive = (await firstClient.run(command)) as {
      id: string;
      action: string;
    };
    expect(directive.action).toBe("render_view");
    expect(JSON.parse(firstFetch.mock.calls[0]![1]!.body as string)).toEqual({
      input: { issue: 42 },
    });

    const secondFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ approvalId: "approval-1" }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, runId: "run-1" }), {
          status: 202,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "approval_required" }), {
          status: 409,
        }),
      );
    const secondClient = createWorkflowApiClient({
      request,
      approval: {
        ...approval,
        latestUserText: `<view_result>${JSON.stringify({
          kind: "view_result",
          view: "renderer",
          viewId: directive.id,
          rendererSlug: "approval-card",
          actionId: "approve",
        })}</view_result>`,
      },
      fetchImpl: secondFetch,
    });

    await expect(secondClient.run(command)).resolves.toMatchObject({
      ok: true,
      runId: "run-1",
    });
    expect(secondFetch.mock.calls[0]![0].toString()).toContain("/approve");
    expect(JSON.parse(secondFetch.mock.calls[0]![1]!.body as string)).toEqual({
      approvalToken: directive.id,
      input: { issue: 42 },
    });
    expect(JSON.parse(secondFetch.mock.calls[1]![1]!.body as string)).toEqual({
      approvalId: "approval-1",
      input: { issue: 42 },
    });

    await secondClient.run(command);
    expect(JSON.parse(secondFetch.mock.calls[2]![1]!.body as string)).toEqual({
      input: { issue: 42 },
    });
  });

  it("uses the exact configuration approval for its first verification run", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "approval_required",
            approvalToken: "workflow.challenge",
          }),
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ approvalId: "approval-config-1" }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, runId: "run-config-1" }), {
          status: 202,
        }),
      );
    const client = createWorkflowApiClient({ request, approval, fetchImpl });
    const command = { workflowId: "daily-ci-watch", input: {} };

    await expect(
      client.run(command, { approvedByConfiguration: true }),
    ).resolves.toMatchObject({ ok: true, runId: "run-config-1" });

    expect(fetchImpl.mock.calls[1]![0].toString()).toContain("/approve");
    expect(JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string)).toEqual({
      approvalToken: "workflow.challenge",
      input: {},
    });
    expect(JSON.parse(fetchImpl.mock.calls[2]![1]!.body as string)).toEqual({
      approvalId: "approval-config-1",
      input: {},
    });
  });
});
