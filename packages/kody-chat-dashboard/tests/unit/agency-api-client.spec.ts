import { describe, expect, it, vi } from "vitest";

import { createAgencyApiClient } from "../../app/api/kody/chat/tools/agency-api-client";

const request = {
  url: "https://dash.test/api/kody/chat/kody",
  headers: new Headers({
    authorization: "Bearer user-token",
    "x-kody-owner": "acme",
    "x-kody-repo": "app",
    "content-length": "999",
  }),
};

function ok(payload: Record<string, unknown> = { ok: true }) {
  return new Response(JSON.stringify(payload), { status: 200 });
}

describe("Agency API client", () => {
  it("uses the Dashboard routes with the authenticated repository context", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok());
    const client = createAgencyApiClient({
      request,
      actorLogin: "alice",
      fetchImpl,
    });

    await client.listAgents();
    await client.readAgent("qa-agent");
    await client.createAgent({
      slug: "qa-agent",
      title: "QA Agent",
      body: "Checks releases.",
    });
    await client.updateAgent("qa-agent", { body: "Checks every release." });
    await client.removeAgent("qa-agent");
    await client.dispatchAgent("qa-agent", "Check release 42");
    await client.listCapabilities();
    await client.readCapability("release");
    await client.createCapability({
      slug: "release",
      instructions: "Release safely.",
      contract: "{}\n",
      skills: [],
      tools: [],
    });
    await client.updateCapability("release", {
      instructions: "Release safely.",
      contract: "{}\n",
      skills: [],
      tools: [],
    });
    await client.removeCapability("release");
    await client.runCapability("release");

    expect(
      fetchImpl.mock.calls.map(([input, init]) => [
        input.toString(),
        init?.method,
      ]),
    ).toEqual([
      ["https://dash.test/api/kody/agents", "GET"],
      ["https://dash.test/api/kody/agents/qa-agent", "GET"],
      ["https://dash.test/api/kody/agents", "POST"],
      ["https://dash.test/api/kody/agents/qa-agent", "PATCH"],
      [
        "https://dash.test/api/kody/agents/qa-agent?actorLogin=alice",
        "DELETE",
      ],
      ["https://dash.test/api/kody/agents/qa-agent/dispatch", "POST"],
      ["https://dash.test/api/kody/capabilities", "GET"],
      ["https://dash.test/api/kody/capabilities/release", "GET"],
      ["https://dash.test/api/kody/capabilities", "POST"],
      ["https://dash.test/api/kody/capabilities/release", "PATCH"],
      [
        "https://dash.test/api/kody/capabilities/release?actorLogin=alice",
        "DELETE",
      ],
      ["https://dash.test/api/kody/capabilities/release/run", "POST"],
    ]);

    const headers = fetchImpl.mock.calls[0]![1]!.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer user-token");
    expect(headers.get("x-kody-owner")).toBe("acme");
    expect(headers.has("content-length")).toBe(false);
    expect(
      JSON.parse(fetchImpl.mock.calls[2]![1]!.body as string),
    ).toMatchObject({ actorLogin: "alice" });
  });

  it("uses the Dashboard lifecycle routes for workflows, loops, intents, todos, and runs", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok());
    const client = createAgencyApiClient({
      request,
      actorLogin: "alice",
      fetchImpl,
    });

    await client.createWorkflow({ name: "Release", capabilities: ["ship"] });
    await client.updateWorkflow("release", { name: "Safe release" });
    await client.removeWorkflow("release");
    await client.listLoops();
    await client.createLoop({
      id: "nightly",
      trigger: { type: "schedule", every: "1d" },
      target: { kind: "workflow", id: "release" },
      input: {},
      enabled: true,
    });
    await client.updateLoop("nightly", {
      trigger: { type: "manual" },
      target: { kind: "workflow", id: "release" },
      input: {},
      enabled: false,
    });
    await client.removeLoop("nightly");
    await client.runLoop("nightly");
    await client.listIntents();
    await client.readIntent("grow");
    await client.createIntent({ slug: "grow", body: "Grow.", agent: ["kody"] });
    await client.updateIntent("grow", { body: "Grow safely." });
    await client.removeIntent("grow");
    await client.listTodos();
    await client.readTodo("launch");
    await client.createTodo({ title: "Launch", items: [] });
    await client.updateTodo("launch", { title: "Launch safely" });
    await client.removeTodo("launch");
    await client.listRuns(25);
    await client.readRun("runs/release-42.json", "42");

    expect(
      fetchImpl.mock.calls.map(([input, init]) => [
        input.toString(),
        init?.method,
      ]),
    ).toEqual([
      ["https://dash.test/api/kody/company/workflows", "POST"],
      ["https://dash.test/api/kody/company/workflows/release", "PATCH"],
      ["https://dash.test/api/kody/company/workflows/release", "DELETE"],
      ["https://dash.test/api/kody/loops", "GET"],
      ["https://dash.test/api/kody/loops", "POST"],
      ["https://dash.test/api/kody/loops/nightly", "PATCH"],
      ["https://dash.test/api/kody/loops/nightly", "DELETE"],
      ["https://dash.test/api/kody/loops/nightly/run", "POST"],
      ["https://dash.test/api/kody/intents", "GET"],
      ["https://dash.test/api/kody/intents/grow", "GET"],
      ["https://dash.test/api/kody/intents", "POST"],
      ["https://dash.test/api/kody/intents/grow", "PATCH"],
      [
        "https://dash.test/api/kody/intents/grow?actorLogin=alice",
        "DELETE",
      ],
      ["https://dash.test/api/kody/todos", "GET"],
      ["https://dash.test/api/kody/todos/launch", "GET"],
      ["https://dash.test/api/kody/todos", "POST"],
      ["https://dash.test/api/kody/todos/launch", "PATCH"],
      [
        "https://dash.test/api/kody/todos/launch?actorLogin=alice",
        "DELETE",
      ],
      ["https://dash.test/api/kody/agency-runs?limit=25", "GET"],
      [
        "https://dash.test/api/kody/agency-runs/detail?runId=runs%2Frelease-42.json&githubRunId=42",
        "GET",
      ],
    ]);
  });

  it("returns safe API errors without leaking server messages", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_slug", message: "Bad" }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "internal", message: "secret backend path" }),
          { status: 500 },
        ),
      );
    const client = createAgencyApiClient({ request, fetchImpl });

    await expect(client.readAgent("bad")).resolves.toEqual({
      error: "invalid_slug",
      message: "Bad",
      status: 400,
    });
    await expect(client.readAgent("bad")).resolves.toEqual({
      error: "internal",
      status: 500,
    });
  });

  it("preserves safe workflow validation issues for Kody to repair", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_workflow",
          message: "Workflow is not safe to save.",
          issues: [
            {
              code: "unknown_capability",
              path: "steps[0].capability",
              message: "Capability qa-scan is not available in this agency.",
            },
          ],
        }),
        { status: 400 },
      ),
    );
    const client = createAgencyApiClient({ request, fetchImpl });

    await expect(
      client.createWorkflow({
        id: "local-workflow",
        name: "Local Workflow",
        capabilities: ["qa-scan"],
      }),
    ).resolves.toEqual({
      error: "invalid_workflow",
      message: "Workflow is not safe to save.",
      issues: [
        {
          code: "unknown_capability",
          path: "steps[0].capability",
          message: "Capability qa-scan is not available in this agency.",
        },
      ],
      status: 400,
    });
  });

  it("chooses the Dashboard create or update route from current persisted state", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ok({ capability: { slug: "release" } }))
      .mockResolvedValueOnce(ok({ capability: { slug: "release" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
      )
      .mockResolvedValueOnce(ok({ workflow: { id: "release" } }))
      .mockResolvedValueOnce(ok({ loops: [{ id: "nightly" }] }))
      .mockResolvedValueOnce(ok({ loop: { id: "nightly" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
      )
      .mockResolvedValueOnce(ok({ entry: { slug: "grow" } }))
      .mockResolvedValueOnce(
        ok({
          todo: {
            slug: "launch",
            items: [
              {
                id: "existing",
                title: "Existing",
                createdAt: "2026-08-01T00:00:00.000Z",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(ok({ todo: { slug: "launch" } }));
    const client = createAgencyApiClient({ request, fetchImpl });

    await client.saveCapability({
      slug: "release",
      instructions: "Release.",
      contract: "{}\n",
      skills: [],
      tools: [],
    });
    await client.saveWorkflow({
      id: "release",
      name: "Release",
      capabilities: ["ship"],
    });
    await client.saveLoop({
      id: "nightly",
      trigger: { type: "manual" },
      target: { kind: "workflow", id: "release" },
      input: {},
      enabled: false,
    });
    await client.saveIntent({ slug: "grow", body: "Grow.", agent: ["kody"] });
    await client.saveTodo({
      slug: "launch",
      title: "Launch",
      items: [{ title: "New item", completed: false }],
    });

    expect(
      fetchImpl.mock.calls.map(([input, init]) => [
        input.toString(),
        init?.method,
      ]),
    ).toEqual([
      ["https://dash.test/api/kody/capabilities/release", "GET"],
      ["https://dash.test/api/kody/capabilities/release", "PATCH"],
      ["https://dash.test/api/kody/company/workflows/release", "GET"],
      ["https://dash.test/api/kody/company/workflows", "POST"],
      ["https://dash.test/api/kody/loops", "GET"],
      ["https://dash.test/api/kody/loops/nightly", "PATCH"],
      ["https://dash.test/api/kody/intents/grow", "GET"],
      ["https://dash.test/api/kody/intents", "POST"],
      ["https://dash.test/api/kody/todos/launch", "GET"],
      ["https://dash.test/api/kody/todos/launch", "PATCH"],
    ]);
    expect(
      JSON.parse(fetchImpl.mock.calls[9]![1]!.body as string).items[0],
    ).toMatchObject({
      id: expect.stringMatching(/^item-/),
      title: "New item",
      completed: false,
      completedAt: null,
    });
  });

  it("keeps an explicit todo slug when creating a missing list", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
      )
      .mockResolvedValueOnce(ok({ todo: { slug: "exact-todo-slug" } }));
    const client = createAgencyApiClient({ request, fetchImpl });

    await client.saveTodo({
      slug: "exact-todo-slug",
      title: "Friendly title",
      items: [],
    });

    expect(
      JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string),
    ).toMatchObject({
      slug: "exact-todo-slug",
      title: "Friendly title",
    });
  });
});
