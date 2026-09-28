import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const tenantId = "acme/widgets";
const actor = {
  tokenId: "token-codex",
  name: "Codex",
  actorLogin: "octocat",
};

describe("inspectable agent runs", () => {
  it("groups MCP calls under a repository-scoped run without transcripts", async () => {
    const t = setup();
    await t.mutation(api.agentRuns.recordCall, {
      tenantId,
      runId: "agent-run-1",
      tokenId: actor.tokenId,
      agentName: actor.name,
      clientName: "codex",
      eventId: "call-1",
      method: "tools/call",
      toolName: "kody_execute_tool",
      actionId: "repository.scope.get",
      outcome: "success",
      occurredAt: "2026-09-02T08:00:00.000Z",
    });
    await t.mutation(api.agentRuns.recordCall, {
      tenantId,
      runId: "agent-run-1",
      tokenId: actor.tokenId,
      agentName: actor.name,
      eventId: "call-2",
      method: "tools/call",
      toolName: "kody_execute_tool",
      actionId: "work.get",
      outcome: "rejected",
      occurredAt: "2026-09-02T08:01:00.000Z",
    });

    const result = await t.query(api.agentRuns.listDetailed, {
      tenantId,
      limit: 20,
      now: "2026-09-02T08:02:00.000Z",
    });
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      runId: "agent-run-1",
      agentName: "Codex",
      clientName: "codex",
      repository: tenantId,
      status: "running",
      startedAt: "2026-09-02T08:00:00.000Z",
      callCount: 2,
      result: "rejected",
      calls: [
        { actionId: "repository.scope.get", outcome: "success" },
        { actionId: "work.get", outcome: "rejected" },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /transcript|prompt|arguments|structuredContent|token-codex/,
    );

    await t.mutation(api.agentRuns.recordCall, {
      tenantId: "other/repository",
      runId: "agent-run-1",
      tokenId: actor.tokenId,
      agentName: actor.name,
      eventId: "call-1",
      method: "tools/call",
      actionId: "repository.scope.get",
      outcome: "success",
      occurredAt: "2026-09-02T08:02:00.000Z",
    });
    const other = await t.query(api.agentRuns.listDetailed, {
      tenantId: "other/repository",
      limit: 20,
      now: "2026-09-02T08:03:00.000Z",
    });
    expect(other.runs[0].callCount).toBe(1);
  });

  it("links a run to inspectable Todo work outcomes", async () => {
    const t = setup();
    await t.mutation(api.repoDocs.save, {
      tenantId,
      kind: "todo:shared-1",
      updatedAt: "2026-09-02T08:59:00.000Z",
      doc: {
        title: "Ship agent activity",
        description: "Make every stored agent action visible",
        createdAt: "2026-09-02T08:58:00.000Z",
        mcpWork: {
          version: 1,
          status: "completed",
          revision: 3,
          summary: "The Activity Agents view is ready.",
          blockers: [],
          updatedBy: actor,
          requests: [],
        },
        items: [
          {
            meta: {
              mcpWorkEvent: {
                type: "evidence",
                payload: {
                  kind: "test",
                  reference: "live:activity-agents",
                  summary: "The real browser journey passed",
                },
                recordedAt: "2026-09-02T08:59:00.000Z",
              },
            },
          },
          {
            meta: {
              mcpWorkEvent: {
                type: "handoff",
                payload: {
                  toAgent: "Claude Code",
                  summary: "Continue from the verified implementation",
                  nextSteps: ["Review the deployment"],
                },
                recordedAt: "2026-09-02T08:59:30.000Z",
              },
            },
          },
        ],
      },
    });
    await t.mutation(api.agentRuns.recordCall, {
      tenantId,
      runId: "agent-run-2",
      tokenId: actor.tokenId,
      agentName: actor.name,
      workRecordId: "shared-1",
      eventId: "call-3",
      method: "tools/call",
      toolName: "kody_execute_tool",
      actionId: "work.handoff.create",
      outcome: "success",
      occurredAt: "2026-09-02T09:00:00.000Z",
    });
    await t.mutation(api.agentRuns.finish, {
      tenantId,
      runId: "agent-run-2",
      status: "completed",
      endedAt: "2026-09-02T09:01:00.000Z",
    });

    const result = await t.query(api.agentRuns.listDetailed, {
      tenantId,
      limit: 20,
      now: "2026-09-02T09:02:00.000Z",
    });
    expect(result.runs[0]).toMatchObject({
      workRecordId: "shared-1",
      summary: "The Activity Agents view is ready.",
      result: "completed",
      evidence: [
        {
          reference: "live:activity-agents",
          summary: "The real browser journey passed",
        },
      ],
      handoff: {
        toAgent: "Claude Code",
        summary: "Continue from the verified implementation",
      },
    });
  });
});
