import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  requireUserAuth: vi.fn<() => Promise<NextResponse | null>>(async () => null),
  getUserRequestAuth: vi.fn((): { token: string } | null => ({
    token: "ghp_test",
  })),
  getRequestAuth: vi.fn((): { owner: string; repo: string } | null => ({
    owner: "acme",
    repo: "widgets",
  })),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "alice", githubId: 42 },
  })),
  verifyRepoWriteAccess: vi.fn<
    () => Promise<{ actorLogin: string } | NextResponse>
  >(async () => ({ actorLogin: "alice" })),
}));

const store = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  definitions: [] as Array<Record<string, unknown>>,
  userState: {} as Record<string, unknown>,
  failUserStateSaves: [] as string[],
  completions: [] as Array<Record<string, unknown>>,
  bindings: [] as Array<Record<string, unknown>>,
  submissions: [] as Array<Record<string, unknown>>,
  effects: [] as Array<Record<string, unknown>>,
  starts: [] as Array<Record<string, unknown>>,
  failCompletionWrites: false,
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    guidedFlows: {
      get: "get",
      getConversationBinding: "getConversationBinding",
      listActive: "listActive",
      list: "list",
      upsert: "upsert",
      startOrResume: "startOrResume",
      update: "update",
      recordCompletion: "recordCompletion",
      saveDefinition: "saveDefinition",
      listDefinitions: "listDefinitions",
      bindConversation: "bindConversation",
      listPendingEffects: "listPendingEffects",
      beginEffect: "beginEffect",
      markEffect: "markEffect",
    },
    userState: {
      get: "userState.get",
      save: "userState.save",
    },
  },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: async (operation: string, args: Record<string, unknown>) => {
      if (operation === "userState.get") {
        const data = store.userState[String(args.namespace)];
        return data === undefined ? null : { data };
      }
      if (operation === "listDefinitions") {
        return store.definitions.map((definition) => ({
          tenantId: args.tenantId,
          flowId: definition.id,
          version: definition.version ?? 1,
          archived: definition.archived,
          definition,
        }));
      }
      if (operation === "listActive") {
        return store.rows.filter(
          (row) =>
            row.tenantId === args.tenantId &&
            row.actorId === args.actorId &&
            row.status === "active",
        );
      }
      if (operation === "list") {
        return store.rows.filter(
          (row) =>
            row.tenantId === args.tenantId && row.actorId === args.actorId,
        );
      }
      if (operation === "getConversationBinding") {
        return (
          store.bindings.find(
            (binding) =>
              binding.tenantId === args.tenantId &&
              binding.actorId === args.actorId &&
              binding.conversationId === args.conversationId,
          ) ?? null
        );
      }
      if (operation === "listPendingEffects") {
        return store.effects
          .filter(
            (effect) =>
              effect.tenantId === args.tenantId &&
              effect.actorId === args.actorId &&
              effect.instanceId === args.instanceId &&
              effect.status !== "completed",
          )
          .map((effect) => ({ ...effect }));
      }
      return (
        store.rows.find(
          (row) =>
            row.tenantId === args.tenantId &&
            row.actorId === args.actorId &&
            row.instanceId === args.instanceId,
        ) ?? null
      );
    },
    mutation: async (operation: string, args: Record<string, unknown>) => {
      if (operation === "recordCompletion") {
        if (store.failCompletionWrites) {
          throw new Error("completions unavailable");
        }
        store.completions.push({ ...args });
        return;
      }
      if (operation === "userState.save") {
        if (store.failUserStateSaves.includes(String(args.namespace))) {
          throw new Error("userState save unavailable");
        }
        store.userState[String(args.namespace)] = args.data;
        return;
      }
      if (operation === "saveDefinition") {
        const latest = store.definitions
          .filter((definition) => definition.id === args.flowId)
          .reduce<Record<string, unknown> | null>(
            (best, definition) =>
              !best ||
              Number(definition.version ?? 1) > Number(best.version ?? 1)
                ? definition
                : best,
            null,
          );
        const available = latest !== null && latest.archived !== true;
        if (args.mode === "create" && available) {
          throw new Error("guided_flow_already_exists");
        }
        if (args.mode !== "create" && !available) {
          throw new Error("guided_flow_not_found");
        }
        const version = Number(latest?.version ?? 0) + 1;
        store.definitions.push({
          ...(args.definition as Record<string, unknown>),
          version,
          ...(args.mode === "archive" ? { archived: true } : {}),
        });
        return version;
      }
      if (operation === "upsert") {
        store.rows.push({ ...args });
        return;
      }
      if (operation === "startOrResume") {
        store.starts.push({ ...args });
        const existing = store.rows.find(
          (row) =>
            row.tenantId === args.tenantId &&
            row.actorId === args.actorId &&
            row.status === "active" &&
            (row.rootFlowId ?? row.flowId) === args.rootFlowId &&
            (row.instanceKey ?? "") === (args.instanceKey ?? ""),
        );
        if (existing && args.restart !== true) {
          return { created: false, instance: existing };
        }
        if (existing) existing.status = "cancelled";
        const { restart: _restart, ...instance } = args;
        store.rows.push(instance);
        return { created: true, instance };
      }
      if (operation === "bindConversation") {
        store.bindings.push({ ...args });
        return;
      }
      if (operation === "markEffect") {
        const effect = store.effects.find(
          (candidate) => candidate.effectId === args.effectId,
        );
        if (effect) Object.assign(effect, args);
        return;
      }
      if (operation === "beginEffect") {
        const effect = store.effects.find(
          (candidate) => candidate.effectId === args.effectId,
        );
        if (effect) {
          effect.attempts = Number(effect.attempts ?? 0) + 1;
        }
        return;
      }
      if (
        operation === "update" &&
        args.completions &&
        store.failCompletionWrites
      ) {
        throw new Error("completions unavailable");
      }
      const row = store.rows.find(
        (candidate) => candidate.instanceId === args.instanceId,
      );
      if (row) Object.assign(row, args);
      if (operation === "update" && args.submission) {
        store.submissions.push({
          tenantId: args.tenantId,
          actorId: args.actorId,
          instanceId: args.instanceId,
          revision: args.revision,
          mutationId: args.mutationId,
          ...(args.submission as Record<string, unknown>),
        });
      }
      if (operation === "update" && Array.isArray(args.completions)) {
        for (const completion of args.completions) {
          const value = completion as Record<string, unknown>;
          if (
            !store.completions.some(
              (candidate) => candidate.instanceId === args.instanceId,
            )
          ) {
            store.completions.push({
              tenantId: args.tenantId,
              actorId: args.actorId,
              instanceId: args.instanceId,
              ...value,
            });
          }
          if (
            !store.effects.some(
              (candidate) => candidate.effectId === value.effectId,
            )
          ) {
            store.effects.push({
              tenantId: args.tenantId,
              actorId: args.actorId,
              instanceId: args.instanceId,
              ...value,
              status: "pending",
              attempts: 0,
            });
          }
        }
      }
    },
  }),
}));

import { GET, POST } from "../../app/api/kody/guided-flows/route";
import { listGuidedFlowDefinitions } from "../../src/dashboard/lib/guided-flows/registry";

function request(
  body?: unknown,
  options: { readonly cookie?: string; readonly includeRepo?: boolean } = {},
): NextRequest {
  const includeRepo = options.includeRepo ?? true;
  return new NextRequest("https://dash.test/api/kody/guided-flows", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(includeRepo
        ? { "x-kody-owner": "acme", "x-kody-repo": "widgets" }
        : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("GuidedFlow route", () => {
  beforeEach(() => {
    store.rows = [];
    store.definitions = [];
    store.userState = {};
    store.failUserStateSaves = [];
    store.completions = [];
    store.bindings = [];
    store.submissions = [];
    store.effects = [];
    store.starts = [];
    store.failCompletionWrites = false;
    vi.clearAllMocks();
    auth.requireKodyAuth.mockResolvedValue(null);
    auth.requireUserAuth.mockResolvedValue(null);
    auth.getUserRequestAuth.mockReturnValue({ token: "ghp_test" });
    auth.getRequestAuth.mockReturnValue({ owner: "acme", repo: "widgets" });
    auth.verifyActorLogin.mockResolvedValue({
      identity: { login: "alice", githubId: 42 },
    });
    auth.verifyRepoWriteAccess.mockResolvedValue({ actorLogin: "alice" });
  });

  it("starts and lists an active flow for the authenticated actor", async () => {
    const response = await POST(
      request({
        action: "start",
        flowId: "create-workflow",
        conversationId: "conversation-1",
      }),
    );
    expect(response.status).toBe(201);
    expect((await response.json()).view.guidedFlow.revision).toBe(0);

    const listed = await GET(request());
    expect(listed.status).toBe(200);
    expect((await listed.json()).flows).toHaveLength(1);
    expect(store.bindings).toEqual([
      expect.objectContaining({
        actorId: "alice",
        conversationId: "conversation-1",
        instanceId: store.rows[0]?.instanceId,
      }),
    ]);
  });

  it("lists only active flows when requested", async () => {
    await POST(
      request({
        action: "start",
        flowId: "create-workflow",
        conversationId: "conversation-1",
      }),
    );
    const active = store.rows[0];
    store.rows.push(
      { ...active, instanceId: "completed-flow", status: "completed" },
      { ...active, instanceId: "cancelled-flow", status: "cancelled" },
    );

    const listed = await GET(
      new NextRequest("https://dash.test/api/kody/guided-flows?status=active", {
        headers: { "x-kody-owner": "acme", "x-kody-repo": "widgets" },
      }),
    );

    expect(listed.status).toBe(200);
    const flows = (await listed.json()).flows as Array<{
      instance: { status: string };
    }>;
    expect(flows).toHaveLength(1);
    expect(flows.every((flow) => flow.instance.status === "active")).toBe(true);
  });

  it("rejects unsupported flow status filters", async () => {
    const response = await GET(
      new NextRequest(
        "https://dash.test/api/kody/guided-flows?status=completed",
        { headers: { "x-kody-owner": "acme", "x-kody-repo": "widgets" } },
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "validation_error" });
  });

  it("lists only the flow owned by the requested conversation", async () => {
    await POST(
      request({
        action: "start",
        flowId: "create-workflow",
        conversationId: "conversation-1",
      }),
    );

    const unrelated = await GET(
      new NextRequest(
        "https://dash.test/api/kody/guided-flows?conversationId=conversation-2",
        { headers: { "x-kody-owner": "acme", "x-kody-repo": "widgets" } },
      ),
    );
    expect((await unrelated.json()).flows).toHaveLength(0);

    const owned = await GET(
      new NextRequest(
        "https://dash.test/api/kody/guided-flows?conversationId=conversation-1",
        { headers: { "x-kody-owner": "acme", "x-kody-repo": "widgets" } },
      ),
    );
    expect((await owned.json()).flows).toHaveLength(1);
  });

  it("starts a fresh instance instead of reopening the active instance", async () => {
    const first = await POST(
      request({ action: "start", flowId: "create-workflow" }),
    );
    const firstInstance = (await first.json()).instance as {
      instanceId: string;
    };

    const second = await POST(
      request({ action: "start", flowId: "create-workflow" }),
    );
    const secondInstance = (await second.json()).instance as {
      instanceId: string;
      currentStepId: string;
      revision: number;
    };

    expect(second.status).toBe(201);
    expect(secondInstance).toMatchObject({
      currentStepId: "choose-capability",
      revision: 0,
    });
    expect(secondInstance.instanceId).not.toBe(firstInstance.instanceId);
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]).toMatchObject({ status: "cancelled" });
    expect(store.rows[1]).toMatchObject({ status: "active" });
    expect(store.starts.at(-1)).toMatchObject({ restart: true });
  });

  it("starts onboarding in the verified user's private scope without a repository", async () => {
    auth.getRequestAuth.mockReturnValue(null);

    const response = await POST(
      request(
        {
          action: "start",
          flowId: "onboarding",
          conversationId: "user-conversation",
        },
        { includeRepo: false },
      ),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(store.rows).toEqual([
      expect.objectContaining({
        tenantId: "user:42",
        actorId: "github:42",
        rootFlowId: "onboarding",
      }),
    ]);
    expect(auth.verifyActorLogin).toHaveBeenCalledOnce();
  });

  it("allows a user-owned GuidedFlow before a repository is attached", async () => {
    auth.getRequestAuth.mockReturnValue(null);

    const response = await POST(
      request(
        { action: "start", flowId: "create-workflow" },
        { includeRepo: false },
      ),
    );

    expect(response.status).toBe(201);
    expect(store.rows).toEqual([
      expect.objectContaining({
        tenantId: "user:42",
        actorId: "github:42",
        rootFlowId: "create-workflow",
      }),
    ]);
  });

  it("does not start onboarding without a verified user", async () => {
    auth.getRequestAuth.mockReturnValue(null);
    auth.getUserRequestAuth.mockReturnValue(null);
    auth.requireUserAuth.mockResolvedValue(
      NextResponse.json({ error: "request_auth_required" }, { status: 401 }),
    );

    const response = await POST(
      request(
        { action: "start", flowId: "onboarding" },
        { includeRepo: false },
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "request_auth_required" });
    expect(store.rows).toHaveLength(0);
  });

  it("continues a user-owned onboarding instance after a repository connects", async () => {
    auth.getRequestAuth.mockReturnValue(null);
    const started = await POST(
      request(
        { action: "start", flowId: "onboarding" },
        { includeRepo: false },
      ),
    );
    const instance = (await started.json()).instance as {
      instanceId: string;
      currentStepId: string;
      revision: number;
    };

    auth.getRequestAuth.mockReturnValue({ owner: "acme", repo: "widgets" });
    const response = await POST(
      request({
        action: "submit",
        instanceId: instance.instanceId,
        stepId: instance.currentStepId,
        actionId: "skip",
        expectedRevision: instance.revision,
        mutationId: "bootstrap-next",
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).instance).toMatchObject({
      instanceId: instance.instanceId,
      currentStepId: "welcome",
      status: "active",
      revision: 1,
    });
    expect(store.rows[0]).toMatchObject({
      tenantId: "user:42",
      actorId: "github:42",
    });
  });

  it("lists all built-in GuidedFlows before a repository is attached", async () => {
    auth.getRequestAuth.mockReturnValue(null);

    const started = await POST(
      request(
        { action: "start", flowId: "onboarding" },
        { includeRepo: false },
      ),
    );
    expect(started.status).toBe(201);

    const listed = await GET(request(undefined, { includeRepo: false }));
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.flows).toHaveLength(1);
    expect(
      body.definitions.map((definition: { id: string }) => definition.id),
    ).toEqual(
      expect.arrayContaining(
        listGuidedFlowDefinitions().map((definition) => definition.id),
      ),
    );
  });

  it("binds an existing instance without changing its progress", async () => {
    const started = await POST(
      request({ action: "start", flowId: "create-workflow" }),
    );
    const instance = (await started.json()).instance as {
      instanceId: string;
      revision: number;
    };

    const response = await POST(
      request({
        action: "bind",
        instanceId: instance.instanceId,
        conversationId: "conversation-2",
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).instance).toMatchObject({
      instanceId: instance.instanceId,
      revision: instance.revision,
    });
    expect(store.bindings.at(-1)).toMatchObject({
      conversationId: "conversation-2",
      instanceId: instance.instanceId,
    });
  });

  it("creates and persists a custom renderer-backed flow definition", async () => {
    const created = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Review a release",
          steps: [
            {
              title: "Confirm the release",
              explanation: "Check the release details.",
              rendererSlug: "approval-card",
            },
          ],
        },
      }),
    );
    expect(created.status).toBe(201);

    expect((await created.json()).definition).toMatchObject({
      id: "review-a-release",
      steps: [{ rendererSlug: "approval-card" }],
    });

    const listed = await GET(request());
    expect(listed.status).toBe(200);
    expect((await listed.json()).definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "review-a-release" }),
      ]),
    );
  });

  it("executes a command step before allowing manual continuation", async () => {
    const created = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Initialize Kody",
          steps: [
            {
              type: "command",
              title: "Initialize Kody Engine",
              explanation: "Run the standard initialization command.",
              command: "/init",
            },
          ],
        },
      }),
    );
    expect(created.status).toBe(201);
    const started = await POST(
      request({ action: "start", flowId: "initialize-kody" }),
    );
    expect(started.status).toBe(201);
    const instanceId = (await started.json()).instance.instanceId as string;

    const premature = await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "step-1",
        expectedRevision: 0,
        actionId: "continue",
        mutationId: "continue-before-run",
      }),
    );
    expect(premature.status).toBe(409);
    expect(await premature.json()).toEqual({ error: "command_not_completed" });

    const fetchMock = vi.fn(async () =>
      Response.json({
        handled: true,
        command: "/init",
        result: { status: "completed", summary: "Engine ready" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const executed = await POST(
        request({
          action: "submit",
          instanceId,
          stepId: "step-1",
          expectedRevision: 0,
          actionId: "run",
          mutationId: "run-init",
        }),
      );
      expect(executed.status).toBe(200);
      expect(await executed.json()).toMatchObject({
        instance: { status: "active", revision: 1 },
        view: {
          rendererSlug: "guided-flow-command",
          data: { status: "completed", summary: "Engine ready" },
        },
      });

      const completed = await POST(
        request({
          action: "submit",
          instanceId,
          stepId: "step-1",
          expectedRevision: 1,
          actionId: "continue",
          mutationId: "continue-after-run",
        }),
      );
      expect(completed.status).toBe(200);
      expect(await completed.json()).toMatchObject({
        instance: { status: "completed", revision: 2 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("blocks command continuation while setup needs attention", async () => {
    const created = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Initialize with warning",
          steps: [
            {
              type: "command",
              title: "Initialize Kody Engine",
              explanation: "Resolve setup warnings before continuing.",
              command: "/init",
            },
          ],
        },
      }),
    );
    const started = await POST(
      request({ action: "start", flowId: "initialize-with-warning" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          handled: true,
          command: "/init",
          result: {
            status: "needs_attention",
            summary: "Webhook FAILED — Not Found (HTTP 404).",
          },
        }),
      ),
    );
    try {
      const executed = await POST(
        request({
          action: "submit",
          instanceId,
          stepId: "step-1",
          expectedRevision: 0,
          actionId: "run",
          mutationId: "run-init-warning",
        }),
      );
      expect(executed.status).toBe(200);
      expect(await executed.json()).toMatchObject({
        view: {
          data: {
            status: "needs_attention",
            actions: [{ id: "run", label: "Run again" }],
          },
        },
      });

      const continued = await POST(
        request({
          action: "submit",
          instanceId,
          stepId: "step-1",
          expectedRevision: 1,
          actionId: "continue",
          mutationId: "continue-after-warning",
        }),
      );
      expect(continued.status).toBe(409);
      expect(await continued.json()).toEqual({
        error: "command_not_completed",
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(created.status).toBe(201);
  });

  it("waits for an opted-in workflow command before enabling continuation", async () => {
    await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Review lesson",
          steps: [
            {
              type: "command",
              title: "Generate review",
              explanation: "Wait for the review report.",
              command: "/run-workflow review-lesson",
              waitForCompletion: true,
            },
          ],
        },
      }),
    );
    const started = await POST(
      request({ action: "start", flowId: "review-lesson" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          handled: true,
          result: {
            status: "completed",
            summary: "Workflow accepted",
            workflowId: "review-lesson-report",
            runId: "run-1",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ run: { state: { status: "running" } } }),
      )
      .mockResolvedValueOnce(
        Response.json({ run: { state: { status: "done" } } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const executed = await POST(
        request({
          action: "submit",
          instanceId,
          stepId: "step-1",
          expectedRevision: 0,
          actionId: "run",
          mutationId: "run-review",
        }),
      );
      expect(await executed.json()).toMatchObject({
        instance: { revision: 1 },
        view: { data: { status: "running", actions: [] } },
      });

      const stillRunning = await POST(
        request({
          action: "sync-command",
          instanceId,
          expectedRevision: 1,
          mutationId: "sync-review-1",
        }),
      );
      expect(await stillRunning.json()).toMatchObject({
        instance: { revision: 1 },
        view: { data: { status: "running" } },
      });

      const completed = await POST(
        request({
          action: "sync-command",
          instanceId,
          expectedRevision: 1,
          mutationId: "sync-review-2",
        }),
      );
      expect(await completed.json()).toMatchObject({
        instance: { revision: 2 },
        view: {
          data: {
            status: "completed",
            actions: expect.arrayContaining([
              expect.objectContaining({ id: "continue" }),
            ]),
          },
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("executes an enabled control and persists the returned flow state", async () => {
    const created = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Back-enabled record",
          controls: ["back"],
          steps: [
            {
              title: "Introduction",
              explanation: "Start the record.",
              rendererSlug: "approval-card",
            },
            {
              title: "Review",
              explanation: "Review the record.",
              rendererSlug: "approval-card",
            },
          ],
        },
      }),
    );
    expect(created.status).toBe(201);

    const started = await POST(
      request({ action: "start", flowId: "back-enabled-record" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;
    const advanced = await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "step-1",
        expectedRevision: 0,
        actionId: "continue",
        mutationId: "advance-before-back",
      }),
    );
    const advancedPayload = await advanced.json();
    expect(advancedPayload.view.ui).toMatchObject({ type: "stack" });

    const backed = await POST(
      request({
        action: "control",
        controlId: "back",
        instanceId,
        expectedRevision: 1,
        mutationId: "back-control",
      }),
    );

    expect(backed.status).toBe(200);
    expect((await backed.json()).instance).toMatchObject({
      currentStepId: "step-1",
      revision: 2,
      backStack: [],
    });
    expect(store.rows[0]).toMatchObject({
      currentStepId: "step-1",
      revision: 2,
    });
  });

  it("rejects a control that the stored flow did not enable", async () => {
    await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Forward-only record",
          steps: [
            {
              title: "Introduction",
              explanation: "Start the record.",
              rendererSlug: "approval-card",
            },
            {
              title: "Review",
              explanation: "Review the record.",
              rendererSlug: "approval-card",
            },
          ],
        },
      }),
    );
    const started = await POST(
      request({ action: "start", flowId: "forward-only-record" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;
    await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "step-1",
        expectedRevision: 0,
        actionId: "continue",
        mutationId: "advance-forward-only",
      }),
    );

    const response = await POST(
      request({
        action: "control",
        controlId: "back",
        instanceId,
        expectedRevision: 1,
        mutationId: "disabled-back-control",
      }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("guided_flow_control_disabled");
    expect(store.rows[0]).toMatchObject({
      currentStepId: "step-2",
      revision: 1,
    });
  });

  it("requires repository write access to change shared definitions", async () => {
    auth.verifyRepoWriteAccess.mockResolvedValueOnce(
      NextResponse.json(
        { error: "write_permission_required" },
        { status: 403 },
      ),
    );

    const response = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Protected flow",
          steps: [
            {
              title: "Protected step",
              explanation: "Only repository writers may publish this.",
              rendererSlug: "approval-card",
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(store.definitions).toEqual([]);
  });

  it("runs a nested flow and resumes the parent with the child result", async () => {
    const child = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Example task",
          steps: [
            {
              title: "Choose the answer",
              explanation: "What is two plus two?",
              rendererSlug: "selection-list",
            },
          ],
        },
      }),
    );
    expect(child.status).toBe(201);

    const parent = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Example guide",
          steps: [
            {
              title: "Introduction",
              explanation: "Start the guide.",
              rendererSlug: "approval-card",
            },
            {
              type: "flow",
              title: "Task",
              explanation: "Complete the task.",
              flowId: "example-task",
              flowVersion: 1,
            },
            {
              title: "Summary",
              explanation: "Review the result.",
              rendererSlug: "approval-card",
            },
          ],
        },
      }),
    );
    expect(parent.status).toBe(201);

    const started = await POST(
      request({ action: "start", flowId: "example-guide" }),
    );
    const startedPayload = await started.json();
    const instanceId = startedPayload.instance.instanceId as string;
    expect(startedPayload).toMatchObject({
      instance: {
        flowId: "example-guide",
        currentStepId: "step-1",
        revision: 0,
      },
    });

    const childStep = await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "step-1",
        expectedRevision: 0,
        actionId: "continue",
        mutationId: "nested-intro",
      }),
    );
    expect(childStep.status).toBe(200);
    expect(await childStep.json()).toMatchObject({
      instance: {
        instanceId,
        flowId: "example-task",
        currentStepId: "step-1",
        revision: 1,
        stack: [
          {
            flowId: "example-guide",
            currentStepId: "step-2",
          },
        ],
      },
      flow: { id: "example-task" },
    });
    expect(store.rows[0]).toMatchObject({
      flowId: "example-task",
      stack: [{ flowId: "example-guide" }],
    });

    const summary = await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "step-1",
        expectedRevision: 1,
        actionId: "continue",
        result: { answer: "four", apiToken: "must-not-be-stored" },
        mutationId: "nested-answer",
      }),
    );
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({
      instance: {
        instanceId,
        flowId: "example-guide",
        currentStepId: "step-3",
        revision: 2,
        stack: [],
        data: {
          flowResults: {
            "step-2": {
              flowId: "example-task",
              status: "completed",
              output: { answer: "four" },
            },
          },
        },
      },
      flow: { id: "example-guide" },
    });
    expect(store.submissions.at(-1)).toMatchObject({
      instanceId,
      revision: 2,
      flowId: "example-task",
      stepId: "step-1",
      actionId: "continue",
      result: { answer: "four" },
    });
    expect(store.submissions.at(-1)?.result).not.toHaveProperty("apiToken");
  });

  it("rejects a nested flow definition that references itself", async () => {
    const response = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Recursive flow",
          steps: [
            {
              type: "flow",
              title: "Again",
              explanation: "Run this flow again.",
              flowId: "recursive-flow",
              flowVersion: 1,
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "recursive_flow",
    });
    expect(store.definitions).toEqual([]);
  });

  it("ignores malformed stored definitions without hiding valid ones", async () => {
    store.definitions = [
      { id: "broken", version: 1, title: "Broken" },
      {
        id: "valid-flow",
        version: 1,
        title: "Valid flow",
        steps: [
          {
            id: "step-1",
            title: "Finish",
            explanation: "Finish.",
            rendererSlug: "approval-card",
            allowedActions: ["continue"],
          },
        ],
      },
    ];

    const listed = await GET(request());

    expect(listed.status).toBe(200);
    expect((await listed.json()).definitions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "valid-flow" })]),
    );
  });

  it("rejects an unknown completion page before saving a definition", async () => {
    const response = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Broken destination",
          completionRouteId: "definitely-not-a-dashboard-route",
          steps: [
            {
              title: "Finish",
              explanation: "Finish the flow.",
              rendererSlug: "approval-card",
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_completion_route",
    });
    expect(store.definitions).toEqual([]);
  });

  it("saves a valid page owned by an authored step", async () => {
    const response = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Configure a secret",
          steps: [
            {
              title: "Add the secret",
              explanation: "Complete this task on the Secrets page.",
              routeId: "secrets",
              rendererSlug: "approval-card",
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      definition: {
        steps: [{ routeId: "secrets" }],
      },
    });
  });

  it("rejects an unknown active-step page before saving a definition", async () => {
    const response = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Broken step destination",
          steps: [
            {
              title: "Open nowhere",
              explanation: "This page does not exist.",
              routeId: "definitely-not-a-dashboard-route",
              rendererSlug: "approval-card",
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_step_route",
    });
  });

  it("completes a legacy flow even when its optional navigation is invalid", async () => {
    store.definitions = [
      {
        id: "legacy-flow",
        version: 1,
        title: "Legacy flow",
        completionRouteId: "removed-dashboard-route",
        steps: [
          {
            id: "step-1",
            title: "Finish",
            explanation: "Finish.",
            rendererSlug: "approval-card",
            allowedActions: ["continue"],
          },
        ],
      },
    ];
    const started = await POST(
      request({ action: "start", flowId: "legacy-flow" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;

    const completed = await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "step-1",
        expectedRevision: 0,
        actionId: "continue",
        mutationId: `guided-flow-${instanceId}-0`,
      }),
    );

    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      instance: { status: "completed" },
    });
  });

  it("updates and deletes a custom flow definition but protects built-ins", async () => {
    const created = await POST(
      request({
        action: "create-definition",
        draft: {
          title: "Review a release",
          steps: [
            {
              title: "Confirm the release",
              explanation: "Check the release details.",
              rendererSlug: "approval-card",
            },
          ],
        },
      }),
    );
    expect(created.status).toBe(201);

    const started = await POST(
      request({ action: "start", flowId: "review-a-release" }),
    );
    expect(started.status).toBe(201);
    const instanceId = (await started.json()).instance.instanceId as string;

    const updated = await POST(
      request({
        action: "update-definition",
        flowId: "review-a-release",
        draft: {
          title: "Review the release",
          steps: [
            {
              title: "Confirm the release",
              explanation: "Review the final details.",
              rendererSlug: "guided-form",
            },
          ],
        },
      }),
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).definition).toMatchObject({
      id: "review-a-release",
      title: "Review the release",
      version: 2,
      steps: [{ rendererSlug: "guided-form" }],
    });

    const oldRun = await GET(
      new NextRequest(
        `https://dash.test/api/kody/guided-flows?instanceId=${instanceId}`,
        { headers: { "x-kody-owner": "acme", "x-kody-repo": "widgets" } },
      ),
    );
    expect(oldRun.status).toBe(200);
    expect(await oldRun.json()).toMatchObject({
      flow: {
        instance: { flowVersion: 1 },
        flow: { title: "Review a release" },
      },
    });

    const newRun = await POST(
      request({
        action: "start",
        flowId: "review-a-release",
        instanceKey: "new-user",
      }),
    );
    expect(newRun.status).toBe(201);
    const newRunPayload = await newRun.json();
    expect(newRunPayload.instance.flowVersion).toBe(2);

    const exactNewRun = await GET(
      new NextRequest(
        `https://dash.test/api/kody/guided-flows?instanceId=${newRunPayload.instance.instanceId}`,
        { headers: { "x-kody-owner": "acme", "x-kody-repo": "widgets" } },
      ),
    );
    expect(exactNewRun.status).toBe(200);
    expect(await exactNewRun.json()).toMatchObject({
      flow: {
        instance: { flowVersion: 2 },
        flow: { title: "Review the release" },
      },
    });

    const restartedRun = await POST(
      request({ action: "start", flowId: "review-a-release" }),
    );
    expect(restartedRun.status).toBe(201);
    const restartedPayload = await restartedRun.json();
    expect(restartedPayload).toMatchObject({
      instance: { flowVersion: 2, revision: 0 },
      flow: { title: "Review the release" },
    });
    expect(restartedPayload.instance.instanceId).not.toBe(instanceId);

    const protectedBuiltin = await POST(
      request({
        action: "update-definition",
        flowId: "create-workflow",
        draft: {
          title: "Do not change",
          steps: [
            {
              title: "Nope",
              explanation: "Nope",
              rendererSlug: "guided-form",
            },
          ],
        },
      }),
    );
    expect(protectedBuiltin.status).toBe(403);

    const deleted = await POST(
      request({ action: "delete-definition", flowId: "review-a-release" }),
    );
    expect(deleted.status).toBe(200);
    const afterDelete = await GET(request());
    expect(await afterDelete.json()).toMatchObject({
      definitions: expect.not.arrayContaining([
        expect.objectContaining({ id: "review-a-release" }),
      ]),
    });

    const oldRunAfterDelete = await GET(
      new NextRequest(
        `https://dash.test/api/kody/guided-flows?instanceId=${instanceId}`,
        { headers: { "x-kody-owner": "acme", "x-kody-repo": "widgets" } },
      ),
    );
    expect(oldRunAfterDelete.status).toBe(200);

    const startAfterDelete = await POST(
      request({
        action: "start",
        flowId: "review-a-release",
        instanceKey: "after-delete",
      }),
    );
    expect(startAfterDelete.status).toBe(404);
  });

  it("lists completed flows and loads an exact instance", async () => {
    const started = await POST(
      request({ action: "start", flowId: "create-workflow" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;
    const cancelled = await POST(
      request({
        action: "cancel",
        instanceId,
        expectedRevision: 0,
        mutationId: "m-cancel",
      }),
    );
    expect(cancelled.status).toBe(200);

    const listed = await GET(request());
    expect((await listed.json()).flows[0].instance.status).toBe("cancelled");

    const exact = await GET(
      new NextRequest(
        `https://dash.test/api/kody/guided-flows?instanceId=${instanceId}`,
        { headers: { "x-kody-owner": "acme", "x-kody-repo": "widgets" } },
      ),
    );
    expect(exact.status).toBe(200);
    expect((await exact.json()).flow.instance.instanceId).toBe(instanceId);
  });

  it("rejects stale renderer submissions", async () => {
    const started = await POST(
      request({ action: "start", flowId: "create-workflow" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;

    const advanced = await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "choose-capability",
        expectedRevision: 0,
        actionId: "submit",
        result: { workflowName: "Checks", capabilitySlug: "run-tests" },
        mutationId: "m-1",
      }),
    );
    expect(advanced.status).toBe(200);

    const stale = await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "choose-capability",
        expectedRevision: 0,
        actionId: "submit",
        result: { workflowName: "Checks", capabilitySlug: "run-tests" },
        mutationId: "m-2",
      }),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("revision_conflict");
  });

  it("returns the current state when the same mutation is retried", async () => {
    const started = await POST(
      request({ action: "start", flowId: "create-workflow" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;
    const submission = {
      action: "submit",
      instanceId,
      stepId: "choose-capability",
      expectedRevision: 0,
      actionId: "submit",
      result: { workflowName: "Checks", capabilitySlug: "run-tests" },
      mutationId: `guided-flow-${instanceId}-0`,
    };

    const first = await POST(request(submission));
    const retry = await POST(request(submission));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      instance: { revision: 1, currentStepId: "review" },
    });
  });

  it("runs the real workflow writer before completing the flow", async () => {
    const started = await POST(
      request({ action: "start", flowId: "create-workflow" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;

    await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "choose-capability",
        expectedRevision: 0,
        actionId: "submit",
        result: { workflowName: "Checks", capabilitySlug: "run-tests" },
        mutationId: "m-workflow-form",
      }),
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workflow: { id: "checks" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    try {
      const completed = await POST(
        request({
          action: "submit",
          instanceId,
          stepId: "review",
          expectedRevision: 1,
          actionId: "approve",
          mutationId: "m-workflow-approve",
        }),
      );
      expect(completed.status).toBe(200);
      expect((await completed.json()).workflow).toEqual({ id: "checks" });
      expect(fetchSpy).toHaveBeenCalledWith(
        new URL("https://dash.test/api/kody/company/workflows"),
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps a failed consumer effect retryable after the flow is committed", async () => {
    const started = await POST(
      request({ action: "start", flowId: "create-workflow" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;

    await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "choose-capability",
        expectedRevision: 0,
        actionId: "submit",
        result: {
          workflowName: "Existing workflow",
          capabilitySlug: "run-tests",
        },
        mutationId: "m-rejected-form",
      }),
    );

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: "workflow_exists",
            message: "Workflow already exists.",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
    );
    const rejected = await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "review",
        expectedRevision: 1,
        actionId: "approve",
        mutationId: "m-rejected-approve",
      }),
    );

    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({
      error: "guided_flow_workflow_exists",
    });
    const current = await GET(
      new NextRequest(
        `https://dash.test/api/kody/guided-flows?instanceId=${instanceId}`,
        { headers: { "x-kody-owner": "acme", "x-kody-repo": "widgets" } },
      ),
    );
    expect((await current.json()).flow.instance.status).toBe("completed");
    expect(store.effects).toMatchObject([{ status: "failed", attempts: 1 }]);
    const retried = await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "review",
        expectedRevision: 1,
        actionId: "approve",
        mutationId: "m-rejected-approve",
      }),
    );
    expect(retried.status).toBe(200);
    expect(store.effects).toMatchObject([{ status: "completed", attempts: 2 }]);
  });

  it("records a completion ledger entry when any flow completes", async () => {
    store.definitions = [
      {
        id: "legacy-flow",
        version: 1,
        title: "Legacy flow",
        steps: [
          {
            id: "step-1",
            title: "Finish",
            explanation: "Finish.",
            rendererSlug: "approval-card",
            allowedActions: ["continue"],
          },
        ],
      },
    ];
    const started = await POST(
      request({ action: "start", flowId: "legacy-flow" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;

    const completed = await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "step-1",
        expectedRevision: 0,
        actionId: "continue",
        result: { score: 9 },
        mutationId: "m-ledger",
      }),
    );

    expect(completed.status).toBe(200);
    expect(store.completions).toEqual([
      expect.objectContaining({
        flowId: "legacy-flow",
        flowVersion: 1,
        actorId: "alice",
        instanceId,
        completedAt: expect.any(String),
        data: expect.objectContaining({ actionId: "continue", score: 9 }),
      }),
    ]);
  });

  it("does not commit a completion without its durable ledger and effect", async () => {
    store.failCompletionWrites = true;
    store.definitions = [
      {
        id: "legacy-flow",
        version: 1,
        title: "Legacy flow",
        steps: [
          {
            id: "step-1",
            title: "Finish",
            explanation: "Finish.",
            rendererSlug: "approval-card",
            allowedActions: ["continue"],
          },
        ],
      },
    ];
    const started = await POST(
      request({ action: "start", flowId: "legacy-flow" }),
    );
    const instanceId = (await started.json()).instance.instanceId as string;

    const completed = await POST(
      request({
        action: "submit",
        instanceId,
        stepId: "step-1",
        expectedRevision: 0,
        actionId: "continue",
        mutationId: "m-ledger-fail",
      }),
    );

    expect(completed.status).toBe(500);
    expect(await completed.json()).toEqual({
      error: "guided_flow_action_failed",
    });
    expect(
      store.rows.find((row) => row.instanceId === instanceId),
    ).toMatchObject({ status: "active", revision: 0 });
  });

  it("does not accept oversized request bodies", async () => {
    const response = await POST(
      new NextRequest("https://dash.test/api/kody/guided-flows", {
        method: "POST",
        headers: {
          "content-length": "100001",
          "x-kody-owner": "acme",
          "x-kody-repo": "widgets",
        },
      }),
    );
    expect(response.status).toBe(413);
  });
});
