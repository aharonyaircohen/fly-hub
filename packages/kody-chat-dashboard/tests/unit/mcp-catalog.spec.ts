import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeKodyAction,
  getKodyAction,
  listKodyActions,
  isReadOnlyAction,
  searchKodyActions,
} from "../../src/dashboard/lib/mcp/catalog";
import type { McpPrincipal } from "../../src/dashboard/lib/mcp/contracts";

const backend = { query: vi.fn(), mutation: vi.fn() };
const services = {
  listWork: vi.fn(),
  getWork: vi.fn(),
  createWork: vi.fn(),
  appendWork: vi.fn(),
  listPolicies: vi.fn(),
  getPolicy: vi.fn(),
  getInstructions: vi.fn(),
  listCapabilities: vi.fn(),
  getCapability: vi.fn(),
  listWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  getQualityGates: vi.fn(),
  listApprovals: vi.fn(),
  getApproval: vi.fn(),
  requestWorkflowRun: vi.fn(),
  requestWorkflowResume: vi.fn(),
  requestCapabilityRun: vi.fn(),
  listSchedules: vi.fn(),
  getSchedule: vi.fn(),
  listTriggers: vi.fn(),
  getTrigger: vi.fn(),
  getWebhookStatus: vi.fn(),
  listNotificationRules: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getUsage: vi.fn(),
  requestScheduleSave: vi.fn(),
  requestScheduleDelete: vi.fn(),
  requestTriggerSave: vi.fn(),
  requestTriggerDelete: vi.fn(),
  requestWebhookReconcile: vi.fn(),
  requestNotificationRuleCreate: vi.fn(),
  requestNotificationRuleDelete: vi.fn(),
  listMemories: vi.fn(),
  getMemory: vi.fn(),
  createMemory: vi.fn(),
  searchMemories: vi.fn(),
  getMemoryHistory: vi.fn(),
  reviseMemory: vi.fn(),
  retireMemory: vi.fn(),
  deleteMemory: vi.fn(),
};

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));

const principal: McpPrincipal = {
  tokenId: "token-1",
  name: "Test",
  tenantId: "acme/widgets",
  actorLogin: "octocat",
  actorGithubId: 42,
  scopes: ["mcp:read", "mcp:execute"],
  createdAt: "2026-09-02T08:00:00.000Z",
  expiresAt: "2026-10-02T08:00:00.000Z",
};

describe("public MCP action catalog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails closed when any read-safety metadata changes", () => {
    const read = getKodyAction("work.list")!;
    expect(isReadOnlyAction(read)).toBe(true);
    expect(isReadOnlyAction({ ...read, permission: "write" })).toBe(false);
    expect(isReadOnlyAction({ ...read, permission: "admin" })).toBe(false);
    expect(isReadOnlyAction({ ...read, sideEffects: true })).toBe(false);
    expect(isReadOnlyAction({ ...read, approval: "required" })).toBe(false);
  });

  it("retains token authorization and input validation on read-only execution", async () => {
    await expect(
      executeKodyAction(
        "work.list",
        {},
        { ...principal, scopes: ["mcp:execute"] },
        { readOnly: true, services },
      ),
    ).rejects.toMatchObject({ code: "insufficient_scope" });
    await expect(
      executeKodyAction("work.get", {}, principal, {
        readOnly: true,
        services,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      executeKodyAction("unknown", {}, principal, { readOnly: true, services }),
    ).rejects.toMatchObject({ code: "action_not_found" });
    expect(services.listWork).not.toHaveBeenCalled();
    expect(services.getWork).not.toHaveBeenCalled();
  });

  it("searches metadata deterministically without query-specific or client-specific mappings", () => {
    expect(searchKodyActions()).toEqual(listKodyActions());
    expect(searchKodyActions("WORKFLOW.LIST")[0].id).toBe("workflow.list");
    expect(searchKodyActions("workflows").map((action) => action.id)).toEqual(
      searchKodyActions("workflow").map((action) => action.id),
    );
    expect(searchKodyActions("work work")).toEqual(searchKodyActions("work"));
    expect(searchKodyActions("nonexistentzzzz")).toEqual([]);
    const category = getKodyAction("workflow.list")!.category;
    const filtered = searchKodyActions("workflow", category);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((action) => action.category === category)).toBe(true);
    expect(searchKodyActions("", "unknown-category")).toEqual([]);
  });

  it("publishes safe metadata without internal executors", () => {
    const actions = listKodyActions();
    expect(actions.map((action) => action.id)).toEqual([
      "repository.scope.get",
      "mcp.contract.get",
      "dashboard.features.list",
      "work.list",
      "work.get",
      "work.create",
      "work.update",
      "work.checkpoint.add",
      "work.evidence.add",
      "work.decision.add",
      "work.handoff.create",
      "work.artifact.add",
      "context.search",
      "memory.list",
      "memory.get",
      "memory.search",
      "memory.history",
      "memory.create",
      "memory.revise",
      "memory.retire",
      "memory.delete",
      "policy.list",
      "policy.get",
      "instruction.get",
      "capability.list",
      "capability.get",
      "workflow.list",
      "workflow.get",
      "quality.gates.get",
      "approval.list",
      "approval.get",
      "workflow.run.request",
      "workflow.resume.request",
      "capability.run.request",
      "schedule.list",
      "schedule.get",
      "trigger.list",
      "trigger.get",
      "webhook.status",
      "notification.rule.list",
      "run.list",
      "run.get",
      "mcp.usage.get",
      "schedule.save.request",
      "schedule.delete.request",
      "trigger.save.request",
      "trigger.delete.request",
      "webhook.reconcile.request",
      "notification.rule.create.request",
      "notification.rule.delete.request",
    ]);
    expect(actions[0]).not.toHaveProperty("execute");
    expect(actions[0]).not.toHaveProperty("input");
    expect(getKodyAction("missing")).toBeNull();
  });

  it("gives agents an example and field guidance for every action", () => {
    for (const action of listKodyActions()) {
      expect(action.examples, `${action.id} needs an example`).not.toHaveLength(
        0,
      );
      const properties = (action.inputSchema.properties ?? {}) as Record<
        string,
        { description?: string }
      >;
      for (const [field, schema] of Object.entries(properties)) {
        expect(
          schema.description,
          `${action.id}.${field} needs a description`,
        ).toBeTruthy();
      }
    }
  });

  it("persists attributed work with durable idempotency context", async () => {
    services.createWork.mockResolvedValue({ recordId: "phase-3", revision: 1 });
    await expect(
      executeKodyAction(
        "work.create",
        { recordId: "phase-3", title: "Phase 3", objective: "Share work" },
        principal,
        { idempotencyKey: "create-phase-3", services },
      ),
    ).resolves.toEqual({ recordId: "phase-3", revision: 1 });
    expect(services.createWork).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "create-phase-3",
      }),
      principal,
    );
  });

  it("returns repository memory with revision provenance", async () => {
    backend.query.mockResolvedValue([
      {
        id: "memory-1",
        kind: "decision",
        content: { title: "Use MCP", summary: "One URL", body: "Details" },
        currentRevisionId: "revision-2",
        updatedAt: "2026-09-02T09:00:00.000Z",
      },
    ]);
    await expect(
      executeKodyAction(
        "context.search",
        { query: "MCP", limit: 5 },
        principal,
      ),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          memoryId: "memory-1",
          revisionId: "revision-2",
        }),
      ],
    });
  });

  it("exposes the complete memory lifecycle through delegated actions", async () => {
    services.listMemories.mockResolvedValue({ memories: [] });
    services.getMemory.mockResolvedValue({ id: "memory-1" });
    services.createMemory.mockResolvedValue({ id: "memory-1" });
    services.searchMemories.mockResolvedValue({ items: [] });
    services.getMemoryHistory.mockResolvedValue({
      memoryId: "memory-1",
      revisions: [],
    });
    services.reviseMemory.mockResolvedValue({
      id: "memory-1",
      currentRevisionId: "revision-2",
    });
    services.retireMemory.mockResolvedValue({
      id: "memory-1",
      status: "superseded",
    });
    services.deleteMemory.mockResolvedValue({ deleted: true });

    await expect(
      executeKodyAction(
        "memory.list",
        { scope: "repository", limit: 10 },
        principal,
        { services },
      ),
    ).resolves.toEqual({ memories: [] });
    await expect(
      executeKodyAction("memory.get", { memoryId: "memory-1" }, principal, {
        services,
      }),
    ).resolves.toEqual({ id: "memory-1" });
    await expect(
      executeKodyAction(
        "memory.create",
        {
          scope: "repository",
          kind: "fact",
          title: "T",
          summary: "S",
          body: "B",
        },
        principal,
        { services, idempotencyKey: "memory-create" },
      ),
    ).resolves.toEqual({ id: "memory-1" });
    await expect(
      executeKodyAction(
        "memory.search",
        { query: "T", scope: "repository", limit: 10 },
        principal,
        { services },
      ),
    ).resolves.toEqual({ items: [] });
    await expect(
      executeKodyAction("memory.history", { memoryId: "memory-1" }, principal, {
        services,
      }),
    ).resolves.toEqual({ memoryId: "memory-1", revisions: [] });
    await expect(
      executeKodyAction(
        "memory.revise",
        {
          memoryId: "memory-1",
          expectedRevisionId: "revision-1",
          kind: "fact",
          title: "T",
          summary: "S2",
          body: "B2",
        },
        principal,
        { services, idempotencyKey: "memory-revise" },
      ),
    ).resolves.toMatchObject({ currentRevisionId: "revision-2" });
    await expect(
      executeKodyAction(
        "memory.retire",
        {
          memoryId: "memory-1",
          expectedRevisionId: "revision-2",
          reason: "Done",
        },
        principal,
        { services, idempotencyKey: "memory-retire" },
      ),
    ).resolves.toMatchObject({ status: "superseded" });
    await expect(
      executeKodyAction("memory.delete", { memoryId: "memory-1" }, principal, {
        services,
        idempotencyKey: "memory-delete",
      }),
    ).resolves.toEqual({ deleted: true });
    expect(getKodyAction("memory.create")).toMatchObject({
      permission: "write",
      sideEffects: true,
    });
    expect(getKodyAction("memory.list")).toMatchObject({
      permission: "read",
      sideEffects: false,
    });
  });

  it("executes all initial read-only actions under verified scope", async () => {
    await expect(
      executeKodyAction("repository.scope.get", {}, principal),
    ).resolves.toEqual({ repository: "acme/widgets", actor: "octocat" });
    await expect(
      executeKodyAction("mcp.contract.get", {}, principal),
    ).resolves.toMatchObject({
      contractVersion: "2026-09-08.1",
      workSystem: "todos",
    });
    await expect(
      executeKodyAction("dashboard.features.list", {}, principal),
    ).resolves.toMatchObject({
      families: expect.arrayContaining(["todos", "automation"]),
    });
    const features = await executeKodyAction(
      "dashboard.features.list",
      {},
      principal,
    );
    expect(features).not.toMatchObject({
      families: expect.arrayContaining(["files", "reports"]),
    });
  });

  it("rejects unknown actions and invalid action input without leaking details", async () => {
    await expect(executeKodyAction("missing", {}, principal)).rejects.toEqual(
      expect.objectContaining({
        code: "action_not_found",
        message: "Unknown action.",
      }),
    );
    await expect(
      executeKodyAction("repository.scope.get", { extra: true }, principal),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "invalid_input",
        message: "Action input is invalid.",
      }),
    );
  });

  it("reads Phase 4 definitions through the existing scoped services", async () => {
    services.listPolicies.mockResolvedValue([{ slug: "safe-changes" }]);
    services.getInstructions.mockResolvedValue({ body: "Keep tests green" });
    services.listWorkflows.mockResolvedValue([{ id: "quality-run" }]);
    await expect(
      executeKodyAction("policy.list", {}, principal, { services }),
    ).resolves.toEqual([{ slug: "safe-changes" }]);
    await expect(
      executeKodyAction("instruction.get", {}, principal, { services }),
    ).resolves.toEqual({ body: "Keep tests green" });
    await expect(
      executeKodyAction("workflow.list", {}, principal, { services }),
    ).resolves.toEqual([{ id: "quality-run" }]);
    expect(services.listPolicies).toHaveBeenCalledWith(principal);
    expect(services.getInstructions).toHaveBeenCalledWith(principal);
    expect(services.listWorkflows).toHaveBeenCalledWith(principal);
  });

  it("creates a durable approval request instead of letting an agent self-approve", async () => {
    services.requestWorkflowRun.mockResolvedValue({
      requestId: "approval-request-1",
      status: "pending",
      workflowId: "quality-run",
      runId: "run-1",
    });
    const result = await executeKodyAction(
      "workflow.run.request",
      {
        workflowId: "quality-run",
        workRecordId: "phase-4",
        input: { target: "main" },
      },
      principal,
      { idempotencyKey: "request-quality-run", services },
    );
    expect(result).toMatchObject({ status: "pending", runId: "run-1" });
    expect(services.requestWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "quality-run",
        workRecordId: "phase-4",
        idempotencyKey: "request-quality-run",
      }),
      principal,
    );
    expect(getKodyAction("workflow.run.request")).toMatchObject({
      permission: "approval",
      approval: "required",
      sideEffects: true,
    });
  });

  it("fails closed when Phase 4 services are unavailable", async () => {
    await expect(
      executeKodyAction("policy.list", {}, principal),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      message: "Kody service is unavailable.",
    });
  });

  it("exposes online automation and monitoring through existing Kody services", async () => {
    services.listSchedules.mockResolvedValue([{ id: "daily", enabled: true }]);
    services.getWebhookStatus.mockResolvedValue({ level: "ok" });
    services.getUsage.mockResolvedValue({ requests: 12, limitPerMinute: 120 });
    await expect(
      executeKodyAction("schedule.list", {}, principal, { services }),
    ).resolves.toEqual([{ id: "daily", enabled: true }]);
    await expect(
      executeKodyAction("webhook.status", {}, principal, { services }),
    ).resolves.toEqual({ level: "ok" });
    await expect(
      executeKodyAction("mcp.usage.get", {}, principal, { services }),
    ).resolves.toEqual({ requests: 12, limitPerMinute: 120 });
  });

  it("turns remote schedule changes into user approval requests", async () => {
    services.requestScheduleSave.mockResolvedValue({
      requestId: "request-schedule",
      status: "pending",
    });
    await expect(
      executeKodyAction(
        "schedule.save.request",
        {
          workRecordId: "phase-5",
          schedule: {
            id: "daily-health",
            every: "1d",
            target: { kind: "capability", id: "ci-health-check" },
            input: {},
            enabled: true,
          },
        },
        principal,
        { idempotencyKey: "schedule-save", services },
      ),
    ).resolves.toMatchObject({ status: "pending" });
    expect(getKodyAction("schedule.save.request")).toMatchObject({
      permission: "approval",
      approval: "required",
    });
  });

  it("requires approval for notification changes and validates secret channels", async () => {
    services.requestNotificationRuleCreate.mockResolvedValue({
      requestId: "request-notification",
      status: "pending",
    });
    await expect(
      executeKodyAction(
        "notification.rule.create.request",
        {
          workRecordId: "phase-5",
          rule: {
            name: "Release alerts",
            event: "release_failed",
            channel: { type: "web-push" },
          },
        },
        principal,
        { idempotencyKey: "notification-create", services },
      ),
    ).resolves.toMatchObject({ status: "pending" });
    expect(services.requestNotificationRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workRecordId: "phase-5",
        idempotencyKey: "notification-create",
      }),
      principal,
    );
    await expect(
      executeKodyAction(
        "notification.rule.create.request",
        {
          workRecordId: "phase-5",
          rule: {
            name: "Unsafe webhook",
            event: "release_failed",
            channel: { type: "generic-webhook", url: "http://example.test" },
          },
        },
        principal,
        { idempotencyKey: "notification-invalid", services },
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});
