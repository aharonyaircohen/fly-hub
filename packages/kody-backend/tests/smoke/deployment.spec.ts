import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
// Intentionally anyApi: dynamic table-name loops / raw-deployment probes
// that must not depend on the generated typed api.
import { anyApi } from "convex/server";
import { api } from "../../convex/_generated/api";
import { createBackendClient } from "../../src/client";

// Smoke layer: a handful of real calls against a live deployment. Skipped
// unless CONVEX_URL is set (i.e. after `npx convex dev` has created the
// project). Mutations require the deployment's service key, so also set
// KODY_SERVICE_KEY (see .env.local).
// Run: CONVEX_URL=… KODY_SERVICE_KEY=… pnpm vitest --project smoke
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.CONVEX_URL;
const serviceKey = process.env.KODY_SERVICE_KEY;

describe.skipIf(!url || !serviceKey)("deployment smoke", () => {
  const client = url ? createBackendClient(url) : null!;
  const tenantId = `smoke-test/${Date.now()}`;

  it("writes and reads a workflow", async () => {
    await client.mutation(anyApi.workflows.save, {
      tenantId,
      workflowId: "smoke",
      definition: { name: "Smoke", agent: "kody" },
      source: "local",
      updatedAt: new Date().toISOString(),
    });
    const got = await client.query(anyApi.workflows.get, {
      tenantId,
      workflowId: "smoke",
    });
    expect(got?.definition?.name).toBe("Smoke");
  });

  it("appends and tails chat events", async () => {
    await client.mutation(anyApi.chatEvents.append, {
      tenantId,
      sessionId: "smoke",
      event: { ping: true },
    });
    const events = await client.query(anyApi.chatEvents.since, {
      tenantId,
      sessionId: "smoke",
      afterSeq: -1,
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it("exposes the User Journey registry", async () => {
    const journeys = await client.query(api.userJourneys.list, {
      tenantId: `${tenantId}/user-journeys`,
    });
    expect(journeys).toEqual([]);
  });

  it("exposes the GuidedFlow registry and persists an instance", async () => {
    const flowTenant = tenantId;
    const flowActor = "smoke-user";
    const instanceId = `smoke-guided-flow-${Date.now()}`;

    const activeBefore = await client.query(api.guidedFlows.listActive, {
      tenantId: flowTenant,
      actorId: flowActor,
    });
    expect(activeBefore).toEqual([]);

    await client.mutation(api.guidedFlows.upsert, {
      tenantId: flowTenant,
      actorId: flowActor,
      instanceId,
      flowId: "create-workflow",
      flowVersion: 1,
      currentStepId: "choose-capability",
      status: "active",
      revision: 0,
      data: {},
      history: [],
      updatedAt: new Date().toISOString(),
    });

    const activeAfter = await client.query(api.guidedFlows.listActive, {
      tenantId: flowTenant,
      actorId: flowActor,
    });
    expect(activeAfter).toHaveLength(1);
    expect(activeAfter[0]).toMatchObject({
      instanceId,
      flowId: "create-workflow",
      currentStepId: "choose-capability",
    });

    await client.mutation(api.guidedFlows.update, {
      tenantId: flowTenant,
      actorId: flowActor,
      instanceId,
      expectedRevision: 0,
      currentStepId: "review",
      status: "cancelled",
      revision: 1,
      data: {},
      history: ["choose-capability"],
      updatedAt: new Date().toISOString(),
      mutationId: `smoke-cancel-${Date.now()}`,
    });

    expect(
      await client.query(api.guidedFlows.get, {
        tenantId: flowTenant,
        actorId: flowActor,
        instanceId,
      }),
    ).toMatchObject({ status: "cancelled", revision: 1 });
  });

  it("persists a canonical conversation through the deployed API", async () => {
    const conversationId = `smoke-conversation-${Date.now()}`;
    const createdAt = new Date().toISOString();

    await client.mutation(api.conversations.create, {
      tenantId,
      conversationId,
      surface: "global",
      scope: { kind: "global" },
      title: "Smoke conversation",
      pinned: false,
      activeAgent: { slug: "kody", title: "Kody" },
      runtime: { kind: "direct", modelId: "smoke" },
      createdBy: "smoke-test",
      createdAt,
      updatedAt: createdAt,
    });
    await client.mutation(api.conversations.appendEntry, {
      tenantId,
      conversationId,
      entryId: "user-1",
      idempotencyKey: "user-1",
      entry: {
        kind: "message",
        role: "user",
        author: { kind: "user", actorId: "smoke-test" },
        content: "storage smoke test",
        status: "committed",
        turnId: "turn-1",
        createdAt,
      },
    });
    await client.mutation(api.conversationTurns.start, {
      tenantId,
      conversationId,
      turnId: "turn-1",
      backend: "direct",
      agent: { slug: "kody", title: "Kody" },
      startedAt: createdAt,
    });
    await client.mutation(api.conversationTurns.updateProgress, {
      tenantId,
      conversationId,
      turnId: "turn-1",
      progress: {
        reasoning: "Checking the durable path.",
        toolCalls: [
          {
            id: "tool-1",
            name: "read_file",
            arguments: { path: "README.md" },
            status: "success",
          },
        ],
      },
      updatedAt: new Date().toISOString(),
    });
    await client.mutation(api.conversationTurns.complete, {
      tenantId,
      conversationId,
      turnId: "turn-1",
      content: "durable reply",
      completedAt: new Date().toISOString(),
    });

    const stored = await client.query(api.conversations.get, {
      tenantId,
      conversationId,
    });
    expect(stored?.conversation.activeAgent.slug).toBe("kody");
    expect(stored?.entries).toHaveLength(2);
    expect(stored?.turns).toHaveLength(1);
    expect(stored?.turns[0]).toMatchObject({
      status: "completed",
      progress: {
        reasoning: "Checking the durable path.",
        toolCalls: [
          {
            id: "tool-1",
            name: "read_file",
            arguments: { path: "README.md" },
            status: "success",
          },
        ],
      },
    });
    expect(stored?.entries[0]?.entry).toMatchObject({
      kind: "message",
      role: "user",
      content: "storage smoke test",
    });
    expect(stored?.entries[1]?.entry).toMatchObject({
      kind: "message",
      role: "assistant",
      content: "durable reply",
    });
  });

  it("promotes queued work after a final-step approval decision exactly once", async () => {
    const now = new Date().toISOString();
    const common = {
      tenantId: tenantId,
      pipelineId: "pipeline",
      concurrencyKey: "main",
      steps: [
        {
          id: "final",
          workflowId: "work",
          decisionFact: "decision",
          status: "pending" as const,
        },
      ],
      now: now,
    };
    await client.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "active",
    });
    await client.mutation(api.pipelineRuns.markDispatched, {
      tenantId: tenantId,
      pipelineId: "pipeline",
      runId: "active",
      stepIndex: 0,
      workflowRunId: "work-run",
      now: now,
    });
    await client.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "waiting",
    });
    const args = {
      tenantId: tenantId,
      workflowRunId: "work-run",
      status: "success" as const,
      output: { decision: "approval" },
      now: now,
    };
    expect(await client.mutation(api.pipelineRuns.advance, args)).toMatchObject(
      {
        kind: "start",
        runId: "waiting",
        stepIndex: 0,
      },
    );
    expect(
      (
        await client.query(api.pipelineRuns.get, {
          tenantId: tenantId,
          pipelineId: "pipeline",
          runId: "waiting",
        })
      )?.status,
    ).toBe("running");
    expect(await client.mutation(api.pipelineRuns.advance, args)).toBeNull();
  });

  it("cleans up its own rows", async () => {
    const result = await client.mutation(anyApi.importExport.clearRepo, {
      tenantId,
    });
    expect(result.deleted).toBeGreaterThan(0);
  });
});
