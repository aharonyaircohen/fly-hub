import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const backend = vi.hoisted(() => ({
  userState: {} as Record<string, unknown>,
  rows: [] as Array<Record<string, unknown>>,
  bindings: [] as Array<Record<string, unknown>>,
  submissions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@kody-ade/backend/api", () => ({
  api: {
    guidedFlows: {
      listActive: "guidedFlows.listActive",
      startOrResume: "guidedFlows.startOrResume",
      upsert: "guidedFlows.upsert",
      listDefinitions: "guidedFlows.listDefinitions",
      get: "guidedFlows.get",
      getConversationBinding: "guidedFlows.getConversationBinding",
      bindConversation: "guidedFlows.bindConversation",
      listSubmissions: "guidedFlows.listSubmissions",
      saveDefinition: "guidedFlows.saveDefinition",
    },
    viewRenderers: {
      list: "viewRenderers.list",
      getVersion: "viewRenderers.getVersion",
    },
    userState: { get: "userState.get" },
  },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: async (operation: string, args: Record<string, unknown>) => {
      if (operation === "userState.get") {
        const data = backend.userState[String(args.namespace)];
        return data === undefined ? null : { data };
      }
      if (operation === "guidedFlows.listDefinitions") {
        const definitions = backend.userState["guided-flow-definitions"];
        return Array.isArray(definitions)
          ? definitions.map((definition) => ({
              flowId: (definition as { id: string }).id,
              version: (definition as { version?: number }).version ?? 1,
              archived: (definition as { archived?: boolean }).archived,
              definition,
            }))
          : [];
      }
      if (
        operation === "viewRenderers.list" ||
        operation === "viewRenderers.getVersion"
      ) {
        return operation === "viewRenderers.list" ? [] : null;
      }
      if (operation === "guidedFlows.listActive") {
        return backend.rows.filter((row) => row.status === "active");
      }
      if (operation === "guidedFlows.get") {
        return (
          backend.rows.find(
            (row) =>
              row.instanceId === args.instanceId &&
              row.actorId === args.actorId &&
              row.tenantId === args.tenantId,
          ) ?? null
        );
      }
      if (operation === "guidedFlows.getConversationBinding") {
        return (
          backend.bindings.find(
            (row) =>
              row.conversationId === args.conversationId &&
              row.actorId === args.actorId &&
              row.tenantId === args.tenantId,
          ) ?? null
        );
      }
      if (operation === "guidedFlows.listSubmissions") {
        return backend.submissions
          .filter(
            (row) =>
              row.instanceId === args.instanceId &&
              row.actorId === args.actorId &&
              row.tenantId === args.tenantId,
          )
          .slice(0, Number(args.limit));
      }
      return null;
    },
    mutation: async (operation: string, args: Record<string, unknown>) => {
      if (operation === "guidedFlows.saveDefinition") {
        const definitions = Array.isArray(
          backend.userState["guided-flow-definitions"],
        )
          ? (backend.userState["guided-flow-definitions"] as Array<
              Record<string, unknown>
            >)
          : [];
        const version =
          definitions.filter((definition) => definition.id === args.flowId)
            .length + 1;
        definitions.push({
          ...(args.definition as Record<string, unknown>),
          version,
        });
        backend.userState["guided-flow-definitions"] = definitions;
        return version;
      }
      if (operation === "guidedFlows.startOrResume") {
        const row = { ...args };
        backend.rows.push(row);
        return { created: true, instance: row };
      }
      if (operation === "guidedFlows.upsert") backend.rows.push({ ...args });
      if (operation === "guidedFlows.bindConversation") {
        backend.bindings.push({ ...args });
      }
    },
  }),
}));

import { createGuidedFlowTools } from "../../app/api/kody/chat/tools/guided-flow-tools";

const CUSTOM_DEFINITION = {
  id: "custom-record",
  version: 1,
  title: "Custom record",
  steps: [
    {
      id: "step-1",
      title: "Question",
      explanation: "Pick the right answer.",
      rendererSlug: "selection-list",
      rendererData: {
        title: "Question",
        items: [
          { id: "opt-1", label: "Right", response: "Right" },
          { id: "opt-2", label: "Wrong", response: "Wrong" },
        ],
      },
      transitions: { "opt-1": "done", "opt-2": "step-1" },
      allowedActions: ["opt-1", "opt-2"],
    },
    {
      id: "done",
      title: "Done",
      explanation: "Finished.",
      rendererSlug: "approval-card",
      allowedActions: ["continue"],
    },
  ],
};

describe("guided_flow_start chat tool", () => {
  beforeEach(() => {
    backend.userState = {};
    backend.rows = [];
    backend.bindings = [];
    backend.submissions = [];
    vi.clearAllMocks();
  });

  it("does not route named configuration creation into an Agency request", () => {
    const tools = createGuidedFlowTools({
      tenantId: "acme/widgets",
      actorId: "alice",
      conversationId: "conversation-1",
    });

    expect(tools.guided_flow_start.description).toContain(
      "Do not use new-agency-request to create a named Workflow, Agent, or Capability",
    );
  });

  it("publishes section as a required top-level field for model tool calls", () => {
    const tools = createGuidedFlowTools({
      tenantId: "acme/widgets",
      actorId: "alice",
      conversationId: "conversation-1",
    });
    const schema = z.toJSONSchema(
      (
        tools.guided_flow_read as unknown as {
          inputSchema: z.ZodType;
        }
      ).inputSchema,
    );

    expect(schema).toMatchObject({
      type: "object",
      required: ["section"],
      properties: {
        section: {
          enum: ["current", "outline", "step", "data", "history"],
        },
      },
    });
  });

  it("returns the bound current step and bounded recent history in one context read", async () => {
    backend.userState["guided-flow-definitions"] = [CUSTOM_DEFINITION];
    backend.rows.push({
      tenantId: "acme/widgets",
      actorId: "alice",
      instanceId: "instance-1",
      flowId: "custom-record",
      flowVersion: 1,
      currentStepId: "step-1",
      status: "active",
      revision: 2,
      data: {},
      history: [],
      stack: [],
    });
    backend.bindings.push({
      tenantId: "acme/widgets",
      actorId: "alice",
      conversationId: "conversation-1",
      instanceId: "instance-1",
    });
    backend.submissions.push({
      tenantId: "acme/widgets",
      actorId: "alice",
      instanceId: "instance-1",
      revision: 1,
      stepId: "intro",
      actionId: "confirm",
      result: { confirmed: true },
    });
    const tools = createGuidedFlowTools({
      tenantId: "acme/widgets",
      actorId: "alice",
      conversationId: "conversation-1",
    });

    expect(
      await tools.guided_flow_context.execute!({}, {} as never),
    ).toMatchObject({
      current: {
        instance: { instanceId: "instance-1", currentStepId: "step-1" },
        currentStep: { id: "step-1", title: "Question" },
      },
      recentHistory: {
        items: [{ stepId: "intro", actionId: "confirm" }],
      },
    });
  });

  it("starts a built-in flow", async () => {
    const tools = createGuidedFlowTools({
      tenantId: "acme/widgets",
      actorId: "alice",
    });
    const result = (await tools.guided_flow_start.execute!(
      { flowId: "create-workflow" },
      {} as never,
    )) as { guidedFlow?: { instanceId: string } };
    expect(result.guidedFlow?.instanceId).toBeTruthy();
  });

  it("creates one validated tenant-authored flow", async () => {
    const tools = createGuidedFlowTools({
      tenantId: "acme/widgets",
      actorId: "alice",
    });

    const result = await tools.guided_flow_create.execute!(
      {
        title: "Course basics",
        steps: [
          {
            title: "Lesson one",
            explanation: "Read lesson one, then continue.",
            rendererSlug: "approval-card",
          },
          {
            title: "Lesson two",
            explanation: "Read lesson two, then finish.",
            rendererSlug: "approval-card",
          },
        ],
      },
      {} as never,
    );

    expect(result).toMatchObject({
      ok: true,
      definition: {
        id: "course-basics",
        version: 1,
        steps: [
          expect.objectContaining({ id: "step-1" }),
          expect.objectContaining({ id: "step-2" }),
        ],
      },
    });
    expect(backend.userState["guided-flow-definitions"]).toHaveLength(1);
  });

  it("starts a custom flow published for the repository", async () => {
    backend.userState["guided-flow-definitions"] = [CUSTOM_DEFINITION];
    const tools = createGuidedFlowTools({
      tenantId: "acme/widgets",
      actorId: "alice",
      conversationId: "conversation-1",
    });
    const result = (await tools.guided_flow_start.execute!(
      { flowId: "custom-record" },
      {} as never,
    )) as { guidedFlow?: { stepId: string }; error?: string };
    expect(result.error).toBeUndefined();
    expect(result.guidedFlow?.stepId).toBe("step-1");
    expect(backend.rows).toHaveLength(1);
    expect(backend.rows[0]).toMatchObject({ flowId: "custom-record" });
    expect(backend.bindings[0]).toMatchObject({
      conversationId: "conversation-1",
      instanceId: backend.rows[0]?.instanceId,
    });
  });

  it("does not persist a flow whose renderer is unavailable", async () => {
    backend.userState["guided-flow-definitions"] = [
      {
        id: "broken-flow",
        version: 1,
        title: "Broken flow",
        steps: [
          {
            id: "step-1",
            title: "Unavailable",
            explanation: "This renderer does not exist.",
            rendererSlug: "missing-renderer",
            rendererVersion: 1,
          },
        ],
      },
    ];
    const tools = createGuidedFlowTools({
      tenantId: "acme/widgets",
      actorId: "alice",
    });

    await expect(
      tools.guided_flow_start.execute!({ flowId: "broken-flow" }, {} as never),
    ).rejects.toThrow("renderer_unavailable");
    expect(backend.rows).toHaveLength(0);
  });

  it("reads only the flow bound to the current conversation", async () => {
    backend.userState["guided-flow-definitions"] = [CUSTOM_DEFINITION];
    backend.rows = [
      {
        tenantId: "acme/widgets",
        actorId: "alice",
        instanceId: "instance-1",
        flowId: "custom-record",
        flowVersion: 1,
        currentStepId: "step-1",
        status: "active",
        revision: 2,
        data: { attempt: 2 },
        output: {},
        history: [],
        stack: [],
      },
    ];
    backend.bindings = [
      {
        tenantId: "acme/widgets",
        actorId: "alice",
        conversationId: "conversation-1",
        instanceId: "instance-1",
      },
    ];
    backend.submissions = [
      {
        tenantId: "acme/widgets",
        actorId: "alice",
        instanceId: "instance-1",
        revision: 2,
        flowId: "custom-record",
        flowVersion: 1,
        stepId: "step-1",
        actionId: "opt-2",
        result: { selected: "Wrong" },
        submittedAt: "2026-07-30T00:00:00.000Z",
      },
    ];
    const tools = createGuidedFlowTools({
      tenantId: "acme/widgets",
      actorId: "alice",
      conversationId: "conversation-1",
    });

    const current = await tools.guided_flow_read.execute!(
      { section: "current" },
      {} as never,
    );
    expect(current).toMatchObject({
      instance: {
        instanceId: "instance-1",
        currentStepId: "step-1",
        revision: 2,
      },
      currentStep: { id: "step-1", title: "Question" },
    });
    expect((current as { instance: unknown }).instance).not.toHaveProperty(
      "data",
    );
    expect(current).not.toHaveProperty("definition");

    const outline = await tools.guided_flow_read.execute!(
      { section: "outline" },
      {} as never,
    );
    expect(outline).toMatchObject({
      definitions: [expect.objectContaining({ id: "custom-record" })],
      modelGuides: [],
    });

    const history = await tools.guided_flow_read.execute!(
      { section: "history", limit: 20 },
      {} as never,
    );
    expect(history).toMatchObject({
      items: [
        {
          stepId: "step-1",
          actionId: "opt-2",
          result: { selected: "Wrong" },
        },
      ],
    });
  });

  it("cannot read an unbound conversation", async () => {
    const tools = createGuidedFlowTools({
      tenantId: "acme/widgets",
      actorId: "alice",
      conversationId: "conversation-without-flow",
    });
    expect(
      await tools.guided_flow_read.execute!(
        { section: "current" },
        {} as never,
      ),
    ).toEqual({ error: "no_guided_flow_bound" });
  });

  it("starts at the active child when a flow begins with a nested flow", async () => {
    backend.userState["guided-flow-definitions"] = [
      {
        id: "parent-flow",
        version: 1,
        title: "Parent flow",
        steps: [
          {
            id: "child",
            type: "flow",
            title: "Run child",
            explanation: "Complete the child flow.",
            flowId: "child-flow",
            flowVersion: 1,
          },
        ],
      },
      {
        id: "child-flow",
        version: 1,
        title: "Child flow",
        steps: [
          {
            id: "answer",
            title: "Answer",
            explanation: "Choose an answer.",
            rendererSlug: "selection-list",
          },
        ],
      },
    ];
    const tools = createGuidedFlowTools({
      tenantId: "acme/widgets",
      actorId: "alice",
    });

    const result = (await tools.guided_flow_start.execute!(
      { flowId: "parent-flow" },
      {} as never,
    )) as { guidedFlow?: { stepId: string }; error?: string };

    expect(result.error).toBeUndefined();
    expect(result.guidedFlow?.stepId).toBe("answer");
    expect(backend.rows).toHaveLength(1);
    expect(backend.rows[0]).toMatchObject({
      flowId: "child-flow",
      stack: [{ flowId: "parent-flow", currentStepId: "child" }],
    });
  });

  it("ignores archived custom flows and unknown ids", async () => {
    backend.userState["guided-flow-definitions"] = [
      { ...CUSTOM_DEFINITION, version: 2, archived: true },
    ];
    const tools = createGuidedFlowTools({
      tenantId: "acme/widgets",
      actorId: "alice",
    });
    const archived = (await tools.guided_flow_start.execute!(
      { flowId: "custom-record" },
      {} as never,
    )) as { error?: string };
    expect(archived.error).toContain("custom-record");

    const unknown = (await tools.guided_flow_start.execute!(
      { flowId: "does-not-exist" },
      {} as never,
    )) as { error?: string };
    expect(unknown.error).toContain("does-not-exist");
  });
});
