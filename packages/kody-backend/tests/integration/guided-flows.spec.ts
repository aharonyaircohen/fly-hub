import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/app";
const ACTOR = "user-1";
const NOW = "2026-07-18T00:00:00.000Z";

const START = {
  tenantId: TENANT,
  actorId: ACTOR,
  instanceId: "flow-instance-1",
  instanceKey: "lesson",
  flowId: "create-workflow",
  flowVersion: 1,
  currentStepId: "choose-capability",
  status: "active" as const,
  revision: 0,
  data: {},
  history: [],
  updatedAt: NOW,
};

describe("guidedFlows", () => {
  it("atomically returns one active instance for the same user and flow key", async () => {
    const t = setup();
    const first = await t.mutation(api.guidedFlows.startOrResume, {
      ...START,
      rootFlowId: START.flowId,
    });
    const second = await t.mutation(api.guidedFlows.startOrResume, {
      ...START,
      instanceId: "flow-instance-2",
      rootFlowId: START.flowId,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.instance.instanceId).toBe(START.instanceId);
    expect(
      await t.query(api.guidedFlows.listActive, {
        tenantId: TENANT,
        actorId: ACTOR,
      }),
    ).toHaveLength(1);
  });

  it("atomically replaces the active instance when start requests a restart", async () => {
    const t = setup();
    await t.mutation(api.guidedFlows.startOrResume, {
      ...START,
      rootFlowId: START.flowId,
    });
    const restarted = await t.mutation(api.guidedFlows.startOrResume, {
      ...START,
      instanceId: "flow-instance-2",
      rootFlowId: START.flowId,
      restart: true,
    });

    expect(restarted.created).toBe(true);
    expect(restarted.instance.instanceId).toBe("flow-instance-2");
    expect(
      await t.query(api.guidedFlows.listActive, {
        tenantId: TENANT,
        actorId: ACTOR,
      }),
    ).toHaveLength(1);
    expect(
      await t.query(api.guidedFlows.get, {
        tenantId: TENANT,
        actorId: ACTOR,
        instanceId: START.instanceId,
      }),
    ).toMatchObject({ status: "cancelled" });
  });

  it("stores and lists active instances per actor and tenant", async () => {
    const t = setup();
    await t.mutation(api.guidedFlows.upsert, START);
    await t.mutation(api.guidedFlows.upsert, {
      ...START,
      instanceId: "other-actor-flow",
      actorId: "user-2",
    });

    const active = await t.query(api.guidedFlows.listActive, {
      tenantId: TENANT,
      actorId: ACTOR,
    });

    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      instanceId: START.instanceId,
      currentStepId: START.currentStepId,
    });
  });

  it("updates only when the expected revision matches", async () => {
    const t = setup();
    await t.mutation(api.guidedFlows.upsert, START);

    await t.mutation(api.guidedFlows.update, {
      tenantId: TENANT,
      actorId: ACTOR,
      instanceId: START.instanceId,
      instanceKey: START.instanceKey,
      expectedRevision: 0,
      currentStepId: "review",
      status: "active",
      revision: 1,
      data: { capability: "test" },
      history: ["choose-capability"],
      updatedAt: NOW,
      mutationId: "mutation-1",
    });

    await expect(
      t.mutation(api.guidedFlows.update, {
        tenantId: TENANT,
        actorId: ACTOR,
        instanceId: START.instanceId,
        expectedRevision: 0,
        currentStepId: "done",
        status: "completed",
        revision: 2,
        data: {},
        history: [],
        updatedAt: NOW,
        mutationId: "mutation-2",
      }),
    ).rejects.toThrow("revision");
  });

  it("stores the active nested flow and its paused parent stack", async () => {
    const t = setup();
    await t.mutation(api.guidedFlows.upsert, START);

    await t.mutation(api.guidedFlows.update, {
      tenantId: TENANT,
      actorId: ACTOR,
      instanceId: START.instanceId,
      expectedRevision: 0,
      flowId: "child-flow",
      flowVersion: 2,
      currentStepId: "child-step",
      status: "active",
      revision: 1,
      data: {},
      output: { answer: "four" },
      history: [],
      stack: [
        {
          flowId: START.flowId,
          flowVersion: START.flowVersion,
          currentStepId: START.currentStepId,
          data: START.data,
          history: START.history,
        },
      ],
      updatedAt: NOW,
      mutationId: "nested-1",
    });

    expect(
      await t.query(api.guidedFlows.get, {
        tenantId: TENANT,
        actorId: ACTOR,
        instanceId: START.instanceId,
      }),
    ).toMatchObject({
      flowId: "child-flow",
      flowVersion: 2,
      currentStepId: "child-step",
      instanceKey: START.instanceKey,
      output: { answer: "four" },
      stack: [
        {
          flowId: START.flowId,
          currentStepId: START.currentStepId,
        },
      ],
    });
  });

  it("returns the stored record for a repeated mutation id", async () => {
    const t = setup();
    await t.mutation(api.guidedFlows.upsert, START);

    const input = {
      tenantId: TENANT,
      actorId: ACTOR,
      instanceId: START.instanceId,
      expectedRevision: 0,
      currentStepId: "review",
      status: "active" as const,
      revision: 1,
      data: { capability: "test" },
      history: ["choose-capability"],
      updatedAt: NOW,
      mutationId: "mutation-1",
    };

    const first = await t.mutation(api.guidedFlows.update, input);
    const second = await t.mutation(api.guidedFlows.update, input);

    expect(second).toEqual(first);
  });

  it("updates the instance and appends one submission atomically", async () => {
    const t = setup();
    await t.mutation(api.guidedFlows.upsert, START);

    await t.mutation(api.guidedFlows.update, {
      tenantId: TENANT,
      actorId: ACTOR,
      instanceId: START.instanceId,
      expectedRevision: 0,
      currentStepId: "review",
      status: "active",
      revision: 1,
      data: { answer: "four" },
      history: ["choose-capability"],
      updatedAt: NOW,
      mutationId: "answer-1",
      submission: {
        flowId: START.flowId,
        flowVersion: START.flowVersion,
        stepId: START.currentStepId,
        actionId: "submit",
        result: { answer: "four" },
        submittedAt: NOW,
      },
    });

    const submissions = await t.query(api.guidedFlows.listSubmissions, {
      tenantId: TENANT,
      actorId: ACTOR,
      instanceId: START.instanceId,
      limit: 20,
    });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      revision: 1,
      stepId: START.currentStepId,
      actionId: "submit",
      result: { answer: "four" },
    });

    await t.mutation(api.guidedFlows.update, {
      tenantId: TENANT,
      actorId: ACTOR,
      instanceId: START.instanceId,
      expectedRevision: 0,
      currentStepId: "review",
      status: "active",
      revision: 1,
      data: { answer: "four" },
      history: ["choose-capability"],
      updatedAt: NOW,
      mutationId: "answer-1",
      submission: {
        flowId: START.flowId,
        flowVersion: START.flowVersion,
        stepId: START.currentStepId,
        actionId: "submit",
        result: { answer: "four" },
        submittedAt: NOW,
      },
    });
    expect(
      await t.query(api.guidedFlows.listSubmissions, {
        tenantId: TENANT,
        actorId: ACTOR,
        instanceId: START.instanceId,
        limit: 20,
      }),
    ).toHaveLength(1);

    await t.mutation(api.guidedFlows.update, {
      tenantId: TENANT,
      actorId: ACTOR,
      instanceId: START.instanceId,
      expectedRevision: 1,
      currentStepId: "review",
      status: "active",
      revision: 2,
      data: { answer: "five" },
      history: ["choose-capability"],
      updatedAt: NOW,
      mutationId: "answer-2",
      submission: {
        flowId: START.flowId,
        flowVersion: START.flowVersion,
        stepId: "review",
        actionId: "retry",
        result: { answer: "five" },
        submittedAt: NOW,
      },
    });
    const newest = await t.query(api.guidedFlows.listSubmissions, {
      tenantId: TENANT,
      actorId: ACTOR,
      instanceId: START.instanceId,
      limit: 1,
    });
    expect(newest.map((submission) => submission.revision)).toEqual([2]);
    const previous = await t.query(api.guidedFlows.listSubmissions, {
      tenantId: TENANT,
      actorId: ACTOR,
      instanceId: START.instanceId,
      beforeRevision: 2,
      limit: 1,
    });
    expect(previous.map((submission) => submission.revision)).toEqual([1]);
  });

  it("stores completion and its pending consumer effect with the transition", async () => {
    const t = setup();
    await t.mutation(api.guidedFlows.upsert, START);

    await t.mutation(api.guidedFlows.update, {
      tenantId: TENANT,
      actorId: ACTOR,
      instanceId: START.instanceId,
      expectedRevision: 0,
      currentStepId: START.currentStepId,
      status: "completed",
      revision: 1,
      data: { workflowName: "Review", capabilitySlug: "review-code" },
      history: [],
      updatedAt: NOW,
      mutationId: "complete-1",
      completions: [
        {
          effectId: `${START.instanceId}:create-workflow@1`,
          flowId: START.flowId,
          flowVersion: START.flowVersion,
          completedAt: NOW,
          data: { workflowName: "Review", capabilitySlug: "review-code" },
        },
      ],
    });

    expect(
      await t.query(api.guidedFlows.listCompletions, {
        tenantId: TENANT,
        actorId: ACTOR,
      }),
    ).toHaveLength(1);
    expect(
      await t.query(api.guidedFlows.listPendingEffects, {
        tenantId: TENANT,
        actorId: ACTOR,
        instanceId: START.instanceId,
      }),
    ).toMatchObject([
      {
        effectId: `${START.instanceId}:create-workflow@1`,
        status: "pending",
      },
    ]);
  });

  it("binds one actor-owned flow instance to one conversation", async () => {
    const t = setup();
    await t.mutation(api.guidedFlows.upsert, START);

    await t.mutation(api.guidedFlows.bindConversation, {
      tenantId: TENANT,
      actorId: ACTOR,
      conversationId: "conversation-1",
      instanceId: START.instanceId,
      updatedAt: NOW,
    });

    expect(
      await t.query(api.guidedFlows.getConversationBinding, {
        tenantId: TENANT,
        actorId: ACTOR,
        conversationId: "conversation-1",
      }),
    ).toMatchObject({ instanceId: START.instanceId });
    expect(
      await t.query(api.guidedFlows.getConversationBinding, {
        tenantId: TENANT,
        actorId: "user-2",
        conversationId: "conversation-1",
      }),
    ).toBeNull();
  });

  it("does not leak instances across tenants", async () => {
    const t = setup();
    await t.mutation(api.guidedFlows.upsert, START);

    expect(
      await t.query(api.guidedFlows.get, {
        tenantId: "other/tenant",
        actorId: ACTOR,
        instanceId: START.instanceId,
      }),
    ).toBeNull();
  });

  const COMPLETION = {
    tenantId: TENANT,
    actorId: ACTOR,
    instanceId: "flow-instance-1",
    flowId: "create-workflow",
    flowVersion: 1,
    completedAt: NOW,
    data: { actionId: "finish", score: 9 },
  };

  it("records completions append-only per actor, newest first", async () => {
    const t = setup();
    await t.mutation(api.guidedFlows.recordCompletion, COMPLETION);
    await t.mutation(api.guidedFlows.recordCompletion, {
      ...COMPLETION,
      instanceId: "flow-instance-2",
      completedAt: "2026-07-19T00:00:00.000Z",
    });

    const completions = await t.query(api.guidedFlows.listCompletions, {
      tenantId: TENANT,
      actorId: ACTOR,
    });

    expect(completions).toHaveLength(2);
    expect(completions[0]).toMatchObject({ instanceId: "flow-instance-2" });
    expect(completions[1]).toMatchObject({
      instanceId: "flow-instance-1",
      data: { actionId: "finish", score: 9 },
    });
  });

  it("versions repository definitions once per tenant", async () => {
    const t = setup();
    const base = {
      tenantId: TENANT,
      flowId: "lesson-1",
      definition: { id: "lesson-1", title: "Lesson", steps: [] },
      updatedAt: NOW,
    };
    expect(
      await t.mutation(api.guidedFlows.saveDefinition, {
        ...base,
        mode: "create",
      }),
    ).toBe(1);
    await expect(
      t.mutation(api.guidedFlows.saveDefinition, { ...base, mode: "create" }),
    ).rejects.toThrow(/guided_flow_already_exists/);
    expect(
      await t.mutation(api.guidedFlows.saveDefinition, {
        ...base,
        mode: "update",
      }),
    ).toBe(2);
    expect(
      await t.mutation(api.guidedFlows.saveDefinition, {
        ...base,
        mode: "archive",
      }),
    ).toBe(3);
    await expect(
      t.mutation(api.guidedFlows.saveDefinition, { ...base, mode: "update" }),
    ).rejects.toThrow(/guided_flow_not_found/);
    // create after archive is allowed and continues the version chain
    expect(
      await t.mutation(api.guidedFlows.saveDefinition, {
        ...base,
        mode: "create",
      }),
    ).toBe(4);

    const rows = await t.query(api.guidedFlows.listDefinitions, {
      tenantId: TENANT,
    });
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.actorId === undefined)).toBe(true);
    expect(
      await t.query(api.guidedFlows.listDefinitions, {
        tenantId: "other/tenant",
      }),
    ).toHaveLength(0);
  });

  it("keeps one completion per instance and none across tenants or actors", async () => {
    const t = setup();
    await t.mutation(api.guidedFlows.recordCompletion, COMPLETION);
    await t.mutation(api.guidedFlows.recordCompletion, COMPLETION);

    expect(
      await t.query(api.guidedFlows.listCompletions, {
        tenantId: TENANT,
        actorId: ACTOR,
      }),
    ).toHaveLength(1);
    expect(
      await t.query(api.guidedFlows.listCompletions, {
        tenantId: "other/tenant",
        actorId: ACTOR,
      }),
    ).toHaveLength(0);
    expect(
      await t.query(api.guidedFlows.listCompletions, {
        tenantId: TENANT,
        actorId: "user-2",
      }),
    ).toHaveLength(0);
  });
});
