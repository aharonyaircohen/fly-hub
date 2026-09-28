import { z } from "zod";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  KODY_MCP_CONTRACT_VERSION,
  toJsonSchema,
  type JsonSchema,
  type McpPrincipal,
  type PermissionClass,
} from "./contracts";
import { NotificationCreateRuleInputSchema } from "../notifications";

type ApprovalPolicy = "none" | "required";

export type KodyAction = {
  id: string;
  title: string;
  summary: string;
  category: string;
  permission: PermissionClass;
  sideEffects: boolean;
  approval: ApprovalPolicy;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  examples: Array<{ input: Record<string, unknown>; description: string }>;
};

type InternalAction = KodyAction & {
  input: z.ZodType;
  execute: (
    input: Record<string, unknown>,
    principal: McpPrincipal,
    context: ActionExecutionContext,
  ) => Promise<unknown> | unknown;
};

export interface KodyMcpActionServices {
  listWork(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  getWork(recordId: string, principal: McpPrincipal): Promise<unknown>;
  createWork(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  appendWork(
    type:
      | "update"
      | "checkpoint"
      | "evidence"
      | "decision"
      | "handoff"
      | "artifact",
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  listPolicies(principal: McpPrincipal): Promise<unknown>;
  getPolicy(slug: string, principal: McpPrincipal): Promise<unknown>;
  getInstructions(principal: McpPrincipal): Promise<unknown>;
  listCapabilities(principal: McpPrincipal): Promise<unknown>;
  getCapability(slug: string, principal: McpPrincipal): Promise<unknown>;
  listWorkflows(principal: McpPrincipal): Promise<unknown>;
  getWorkflow(id: string, principal: McpPrincipal): Promise<unknown>;
  getQualityGates(principal: McpPrincipal): Promise<unknown>;
  listApprovals(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  getApproval(requestId: string, principal: McpPrincipal): Promise<unknown>;
  requestWorkflowRun(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  requestWorkflowResume(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  requestCapabilityRun(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  listSchedules(principal: McpPrincipal): Promise<unknown>;
  getSchedule(id: string, principal: McpPrincipal): Promise<unknown>;
  listTriggers(principal: McpPrincipal): Promise<unknown>;
  getTrigger(id: string, principal: McpPrincipal): Promise<unknown>;
  getWebhookStatus(principal: McpPrincipal): Promise<unknown>;
  listNotificationRules(principal: McpPrincipal): Promise<unknown>;
  listRuns(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  getRun(runId: string, principal: McpPrincipal): Promise<unknown>;
  getUsage(principal: McpPrincipal): Promise<unknown>;
  requestScheduleSave(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  requestScheduleDelete(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  requestTriggerSave(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  requestTriggerDelete(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  requestWebhookReconcile(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  requestNotificationRuleCreate(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  requestNotificationRuleDelete(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  listMemories(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  getMemory(memoryId: string, principal: McpPrincipal): Promise<unknown>;
  createMemory(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  searchMemories(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  getMemoryHistory(memoryId: string, principal: McpPrincipal): Promise<unknown>;
  reviseMemory(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  retireMemory(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
  deleteMemory(
    input: Record<string, unknown>,
    principal: McpPrincipal,
  ): Promise<unknown>;
}

export type ActionExecutionContext = {
  readOnly?: boolean;
  idempotencyKey?: string;
  services?: KodyMcpActionServices;
};

const emptyInput = z.object({}).strict();
const recordId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .describe(
    "Stable lowercase Todo work ID using letters, numbers, hyphens, or underscores.",
  );
const shortText = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .describe("Short human-readable text.");
const longText = z
  .string()
  .trim()
  .min(1)
  .max(5_000)
  .describe("Detailed human-readable text.");
const status = z
  .enum(["planned", "active", "blocked", "completed", "cancelled"])
  .describe("Current lifecycle state of the Todo work.");
const reference = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .describe("URL, path, commit, deployment, or other durable reference.");
const expectedRevision = z
  .number()
  .int()
  .positive()
  .describe("Revision returned by the latest work.get or write result.");
const createWorkInput = z
  .object({
    recordId,
    title: shortText,
    objective: longText,
    status: status.optional(),
    summary: z
      .string()
      .trim()
      .max(5_000)
      .describe("Current concise summary for another agent.")
      .optional(),
    goal: shortText.optional(),
    tasks: z
      .array(shortText)
      .max(100)
      .describe("Concrete tasks required to complete the objective.")
      .optional(),
  })
  .strict();
const listWorkInput = z
  .object({
    status: status.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum work records to return."),
  })
  .strict();
const getWorkInput = z.object({ recordId }).strict();
const updateWorkInput = z
  .object({
    recordId,
    expectedRevision,
    title: shortText.optional(),
    objective: longText.optional(),
    status: status.optional(),
    summary: longText.optional(),
    goal: shortText.optional(),
    tasks: z
      .array(shortText)
      .max(100)
      .describe("Replacement list of concrete remaining tasks.")
      .optional(),
    blockers: z
      .array(shortText)
      .max(100)
      .describe("Current conditions preventing progress.")
      .optional(),
  })
  .strict()
  .refine(
    ({ recordId: _recordId, expectedRevision: _revision, ...patch }) =>
      Object.keys(patch).length > 0,
  );
const checkpointInput = z
  .object({
    recordId,
    expectedRevision,
    summary: longText,
  })
  .strict();
const evidenceInput = z
  .object({
    recordId,
    expectedRevision,
    kind: shortText,
    reference,
    summary: longText,
  })
  .strict();
const decisionInput = z
  .object({
    recordId,
    expectedRevision,
    summary: longText,
    rationale: longText.optional(),
  })
  .strict();
const handoffInput = z
  .object({
    recordId,
    expectedRevision,
    toAgent: shortText,
    summary: longText,
    nextSteps: z
      .array(shortText)
      .min(1)
      .max(50)
      .describe("Concrete steps for the next agent."),
  })
  .strict();
const artifactInput = z
  .object({
    recordId,
    expectedRevision,
    kind: shortText,
    reference,
    summary: longText,
  })
  .strict();
const contextSearchInput = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Words or topic to find in repository memory."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum matching memories to return."),
  })
  .strict();
const memoryScope = z
  .enum(["personal", "repository", "all"])
  .default("all")
  .describe("Memory scope to read or write.");
const memoryDefinitionId = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  .describe("Stable memory ID returned by Kody.");
const memoryKind = z
  .enum(["preference", "fact", "decision", "reference"])
  .describe("The kind of durable memory.");
const memoryEvidence = z
  .array(
    z
      .object({
        source: z
          .enum([
            "user-input",
            "conversation",
            "message",
            "pull-request",
            "document",
            "engine-run",
          ])
          .describe("Evidence source type."),
        id: z.string().trim().min(1).max(200).describe("Evidence identifier."),
        conversationId: z.string().trim().min(1).max(200).optional(),
        uri: z.string().trim().min(1).max(2_000).optional(),
      })
      .strict(),
  )
  .min(1)
  .max(20)
  .optional()
  .describe("References supporting this memory.");
const memoryIdInput = z.object({ memoryId: memoryDefinitionId }).strict();
const memoryListInput = z
  .object({
    scope: memoryScope,
    cursor: z
      .string()
      .min(1)
      .max(10000)
      .optional()
      .describe(
        "Continuation cursor returned by memory.list; keep the same scope.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum memories to return."),
  })
  .strict();
const memorySearchInput = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Words or topic to find in durable memory."),
    scope: memoryScope,
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum matching memories to return."),
  })
  .strict();
const memoryCreateInput = z
  .object({
    scope: z
      .enum(["personal", "repository"])
      .describe("Where the memory belongs."),
    kind: memoryKind,
    title: z.string().trim().min(1).max(120).describe("Short memory title."),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("One sentence summary."),
    body: z
      .string()
      .trim()
      .min(1)
      .max(20_000)
      .describe("Full memory contents."),
    evidence: memoryEvidence,
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe("Why this memory was saved."),
    expiresAt: z
      .string()
      .datetime()
      .optional()
      .describe("Optional ISO expiry timestamp."),
  })
  .strict();
const memoryReviseInput = z
  .object({
    memoryId: memoryDefinitionId,
    expectedRevisionId: z
      .string()
      .trim()
      .min(1)
      .describe("Revision currently held by the agent."),
    kind: memoryKind,
    title: z.string().trim().min(1).max(120).describe("Short memory title."),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("One sentence summary."),
    body: z
      .string()
      .trim()
      .min(1)
      .max(20_000)
      .describe("Full memory contents."),
    evidence: memoryEvidence,
    expiresAt: z
      .string()
      .datetime()
      .optional()
      .describe("Optional replacement ISO expiry timestamp."),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe("Why this memory changed."),
  })
  .strict();
const memoryRetireInput = z
  .object({
    memoryId: memoryDefinitionId,
    expectedRevisionId: z
      .string()
      .trim()
      .min(1)
      .describe("Revision currently held by the agent."),
    evidence: memoryEvidence,
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Why this memory is no longer current."),
  })
  .strict();
const definitionId = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  .describe("Stable Kody resource ID from the corresponding list action.");
const getDefinitionInput = z.object({ id: definitionId }).strict();
const approvalListInput = z
  .object({
    status: z
      .enum([
        "pending",
        "approving",
        "rejected",
        "dispatched",
        "failed",
        "expired",
      ])
      .describe("Approval state to filter by.")
      .optional(),
    workRecordId: recordId.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum approval requests to return."),
  })
  .strict();
const approvalGetInput = z.object({ requestId: definitionId }).strict();
const workflowRunInput = z
  .object({
    workflowId: definitionId,
    workRecordId: recordId,
    input: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("Input passed to the selected workflow."),
  })
  .strict();
const workflowResumeInput = z
  .object({
    workflowId: definitionId,
    workRecordId: recordId,
    runId: z
      .string()
      .trim()
      .regex(/^run-[a-zA-Z0-9_-]{1,123}$/)
      .describe("Paused run ID returned by Kody."),
  })
  .strict();
const capabilityRunInput = z
  .object({
    capabilityId: definitionId,
    workRecordId: recordId,
    input: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("Input passed to the selected capability."),
  })
  .strict();
const runListInput = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum remote runs to return."),
  })
  .strict();
const runGetInput = z
  .object({
    runId: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe("Run ID returned by run.list or an execution request."),
  })
  .strict();
const scheduleDefinition = z
  .object({
    id: definitionId,
    every: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("Schedule interval accepted by Kody, such as 1h or 1d."),
    at: z
      .object({
        time: z
          .string()
          .trim()
          .min(1)
          .max(20)
          .describe("Local time in HH:mm format."),
        timezone: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .describe("IANA timezone, such as Europe/London."),
      })
      .strict()
      .optional(),
    target: z
      .object({
        kind: z
          .enum(["workflow", "capability", "pipeline", "agent"])
          .describe("Type of Kody resource the schedule starts."),
        id: definitionId,
      })
      .strict(),
    input: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("Input passed to the scheduled target."),
    enabled: z
      .boolean()
      .default(true)
      .describe("Whether this schedule may run."),
  })
  .strict();
const scheduleSaveInput = z
  .object({
    workRecordId: recordId,
    schedule: scheduleDefinition.describe(
      "Complete schedule to create or replace.",
    ),
  })
  .strict();
const automationDeleteInput = z
  .object({ workRecordId: recordId, id: definitionId })
  .strict();
const triggerSaveInput = z
  .object({
    workRecordId: recordId,
    trigger: z
      .record(z.string(), z.unknown())
      .describe("Complete trigger definition accepted by Kody."),
  })
  .strict();
const webhookReconcileInput = z.object({ workRecordId: recordId }).strict();
const notificationRuleCreateInput = z
  .object({
    workRecordId: recordId,
    rule: NotificationCreateRuleInputSchema.describe(
      "Notification rule to create after user approval.",
    ),
  })
  .strict();

const workOutputSchema: JsonSchema = { type: "object" };

function requireIdempotency(context: ActionExecutionContext): string {
  if (!context.idempotencyKey)
    throw new KodyActionError(
      "idempotency_key_required",
      "Write actions require an idempotency key.",
    );
  return context.idempotencyKey;
}

function requireServices(
  context: ActionExecutionContext,
): KodyMcpActionServices {
  if (!context.services)
    throw new KodyActionError(
      "service_unavailable",
      "Kody service is unavailable.",
    );
  return context.services;
}

function delegatedReadAction(input: {
  id: string;
  title: string;
  summary: string;
  category: string;
  schema?: z.ZodType;
  execute: (
    parsed: Record<string, unknown>,
    services: KodyMcpActionServices,
    principal: McpPrincipal,
  ) => Promise<unknown>;
}): InternalAction {
  const schema = input.schema ?? emptyInput;
  return {
    id: input.id,
    title: input.title,
    summary: input.summary,
    category: input.category,
    permission: "read",
    sideEffects: false,
    approval: "none",
    input: schema,
    inputSchema: toJsonSchema(schema),
    outputSchema: { type: "object" },
    examples: [],
    execute: async (parsed, principal, context) =>
      await input.execute(parsed, requireServices(context), principal),
  };
}

function memoryReadAction(input: {
  id: string;
  title: string;
  summary: string;
  schema?: z.ZodType;
  execute: (
    parsed: Record<string, unknown>,
    services: KodyMcpActionServices,
    principal: McpPrincipal,
  ) => Promise<unknown>;
}): InternalAction {
  const schema = input.schema ?? emptyInput;
  return {
    id: input.id,
    title: input.title,
    summary: input.summary,
    category: "memory",
    permission: "read",
    sideEffects: false,
    approval: "none",
    input: schema,
    inputSchema: toJsonSchema(schema),
    outputSchema: { type: "object" },
    examples: [],
    execute: async (parsed, principal, context) =>
      await input.execute(parsed, requireServices(context), principal),
  };
}

function memoryWriteAction(input: {
  id: string;
  title: string;
  summary: string;
  schema: z.ZodType;
  execute: (
    parsed: Record<string, unknown>,
    services: KodyMcpActionServices,
    principal: McpPrincipal,
    idempotencyKey: string,
  ) => Promise<unknown>;
}): InternalAction {
  return {
    id: input.id,
    title: input.title,
    summary: input.summary,
    category: "memory",
    permission: "write",
    sideEffects: true,
    approval: "none",
    input: input.schema,
    inputSchema: toJsonSchema(input.schema),
    outputSchema: { type: "object" },
    examples: [],
    execute: async (parsed, principal, context) =>
      await input.execute(
        parsed,
        requireServices(context),
        principal,
        requireIdempotency(context),
      ),
  };
}

function approvalRequestAction(input: {
  id: string;
  title: string;
  summary: string;
  schema: z.ZodType;
  execute: (
    parsed: Record<string, unknown>,
    services: KodyMcpActionServices,
    principal: McpPrincipal,
  ) => Promise<unknown>;
}): InternalAction {
  return {
    id: input.id,
    title: input.title,
    summary: input.summary,
    category: "approvals",
    permission: "approval",
    sideEffects: true,
    approval: "required",
    input: input.schema,
    inputSchema: toJsonSchema(input.schema),
    outputSchema: { type: "object" },
    examples: [],
    execute: async (parsed, principal, context) =>
      await input.execute(
        { ...parsed, idempotencyKey: requireIdempotency(context) },
        requireServices(context),
        principal,
      ),
  };
}

function workAction(
  definition: Omit<
    InternalAction,
    "category" | "permission" | "sideEffects" | "approval" | "outputSchema"
  >,
): InternalAction {
  return {
    ...definition,
    category: "work",
    permission: "write",
    sideEffects: true,
    approval: "none",
    outputSchema: workOutputSchema,
  };
}

function appendWorkAction(
  id: string,
  title: string,
  summary: string,
  input: z.ZodType,
  type:
    "update" | "checkpoint" | "evidence" | "decision" | "handoff" | "artifact",
): InternalAction {
  return workAction({
    id,
    title,
    summary,
    input,
    inputSchema: toJsonSchema(input),
    examples: [],
    execute: async (parsed, principal, context) => {
      return await requireServices(context).appendWork(
        type,
        {
          ...parsed,
          idempotencyKey: requireIdempotency(context),
          actionId: id,
        },
        principal,
      );
    },
  });
}

const INTERNAL_ACTIONS: readonly InternalAction[] = [
  {
    id: "repository.scope.get",
    title: "Get repository scope",
    summary:
      "Return the verified Kody repository and actor for this connection.",
    category: "repository",
    permission: "read",
    sideEffects: false,
    approval: "none",
    input: emptyInput,
    inputSchema: toJsonSchema(emptyInput),
    outputSchema: {
      type: "object",
      properties: {
        repository: { type: "string" },
        actor: { type: "string" },
      },
      required: ["repository", "actor"],
      additionalProperties: false,
    },
    examples: [{ input: {}, description: "Show the active Kody scope." }],
    execute: (_input, principal) => ({
      repository: principal.tenantId,
      actor: principal.actorLogin,
    }),
  },
  {
    id: "mcp.contract.get",
    title: "Get MCP work contract",
    summary:
      "Return the versioned contract agents use for Todo work, evidence, and handoffs.",
    category: "mcp",
    permission: "read",
    sideEffects: false,
    approval: "none",
    input: emptyInput,
    inputSchema: toJsonSchema(emptyInput),
    outputSchema: {
      type: "object",
      properties: {
        contractVersion: { type: "string" },
        workSystem: { type: "string" },
        workRoute: { type: "string" },
      },
      required: ["contractVersion", "workSystem", "workRoute"],
    },
    examples: [{ input: {}, description: "Inspect Kody's handoff record." }],
    execute: () => ({
      contractVersion: KODY_MCP_CONTRACT_VERSION,
      workSystem: "todos",
      workRoute: "/repo/{owner}/{repo}/todos/{recordId}",
    }),
  },
  {
    id: "dashboard.features.list",
    title: "List Kody feature families",
    summary: "List the Kody feature families currently exposed through MCP.",
    category: "dashboard",
    permission: "read",
    sideEffects: false,
    approval: "none",
    input: emptyInput,
    inputSchema: toJsonSchema(emptyInput),
    outputSchema: {
      type: "object",
      properties: { families: { type: "array", items: { type: "string" } } },
      required: ["families"],
    },
    examples: [{ input: {}, description: "See Kody's extension surface." }],
    execute: () => ({
      families: [
        "todos",
        "context",
        "policies",
        "capabilities",
        "workflows",
        "approvals",
        "automation",
        "activity",
      ],
    }),
  },
  {
    id: "work.list",
    title: "List Todo work",
    summary: "List current agent work for this repository.",
    category: "work",
    permission: "read",
    sideEffects: false,
    approval: "none",
    input: listWorkInput,
    inputSchema: toJsonSchema(listWorkInput),
    outputSchema: { type: "array", items: workOutputSchema },
    examples: [
      {
        input: { limit: 20 },
        description: "See work another agent can continue.",
      },
    ],
    execute: async (input, principal, context) =>
      await requireServices(context).listWork(input, principal),
  },
  {
    id: "work.get",
    title: "Get Todo work",
    summary: "Read one work record and its attributed activity.",
    category: "work",
    permission: "read",
    sideEffects: false,
    approval: "none",
    input: getWorkInput,
    inputSchema: toJsonSchema(getWorkInput),
    outputSchema: { type: "object" },
    examples: [
      {
        input: { recordId: "phase-3" },
        description: "Continue existing work without its raw transcript.",
      },
    ],
    execute: async (input, principal, context) =>
      await requireServices(context).getWork(String(input.recordId), principal),
  },
  workAction({
    id: "work.create",
    title: "Create Todo work",
    summary: "Create a durable Todo for agent collaboration.",
    input: createWorkInput,
    inputSchema: toJsonSchema(createWorkInput),
    examples: [
      {
        input: {
          recordId: "phase-3",
          title: "Phase 3",
          objective: "Share work",
        },
        description: "Start Todo work.",
      },
    ],
    execute: async (input, principal, context) =>
      await requireServices(context).createWork(
        {
          ...input,
          idempotencyKey: requireIdempotency(context),
          actionId: "work.create",
        },
        principal,
      ),
  }),
  appendWorkAction(
    "work.update",
    "Update Todo work",
    "Update status, summary, goals, tasks, or blockers with revision protection.",
    updateWorkInput,
    "update",
  ),
  appendWorkAction(
    "work.checkpoint.add",
    "Add checkpoint",
    "Record durable progress another agent can inspect.",
    checkpointInput,
    "checkpoint",
  ),
  appendWorkAction(
    "work.evidence.add",
    "Add evidence",
    "Attach test, deployment, commit, URL, or other proof.",
    evidenceInput,
    "evidence",
  ),
  appendWorkAction(
    "work.decision.add",
    "Add decision",
    "Record a decision and optional rationale.",
    decisionInput,
    "decision",
  ),
  appendWorkAction(
    "work.handoff.create",
    "Create handoff",
    "Tell a named next agent what is complete and what to do next.",
    handoffInput,
    "handoff",
  ),
  appendWorkAction(
    "work.artifact.add",
    "Add artifact",
    "Attach a file, commit, pull request, report, or deployment reference.",
    artifactInput,
    "artifact",
  ),
  {
    id: "context.search",
    title: "Search repository context",
    summary: "Search Kody repository memory and return revision provenance.",
    category: "context",
    permission: "read",
    sideEffects: false,
    approval: "none",
    input: contextSearchInput,
    inputSchema: toJsonSchema(contextSearchInput),
    outputSchema: { type: "object" },
    examples: [
      {
        input: { query: "MCP architecture", limit: 10 },
        description: "Recover relevant Kody knowledge.",
      },
    ],
    execute: async (input, principal) => {
      const rows = await createBackendClient().query(
        backendApi.memories.search,
        {
          actor: { kind: "user", id: `github:${principal.actorGithubId}` },
          tenantId: principal.tenantId,
          scope: { kind: "repository", tenantId: principal.tenantId },
          searchText: String(input.query),
          limit: Number(input.limit),
        },
      );
      const now = Date.now();
      return {
        items: (rows as Array<Record<string, any>>)
          .filter(
            (memory) =>
              memory.status === undefined ||
              (memory.status === "active" &&
                (!memory.expiresAt || Date.parse(memory.expiresAt) > now)),
          )
          .map((memory) => ({
            memoryId: memory.id,
            kind: memory.kind,
            title: memory.content.title,
            summary: memory.content.summary,
            body: memory.content.body,
            revisionId: memory.currentRevisionId,
            updatedAt: memory.updatedAt,
            provenance: {
              repository: principal.tenantId,
              source: "kody-memory",
              revisionId: memory.currentRevisionId,
            },
          })),
      };
    },
  },
  memoryReadAction({
    id: "memory.list",
    title: "List memory",
    summary: "List active durable personal and repository memories.",
    schema: memoryListInput,
    execute: (input, services, principal) =>
      services.listMemories(input, principal),
  }),
  memoryReadAction({
    id: "memory.get",
    title: "Get memory",
    summary: "Read one durable memory and its current revision metadata.",
    schema: memoryIdInput,
    execute: (input, services, principal) =>
      services.getMemory(String(input.memoryId), principal),
  }),
  memoryReadAction({
    id: "memory.search",
    title: "Search memory",
    summary: "Search active durable memories across the selected scope.",
    schema: memorySearchInput,
    execute: (input, services, principal) =>
      services.searchMemories(input, principal),
  }),
  memoryReadAction({
    id: "memory.history",
    title: "Read memory history",
    summary: "Read every revision and its evidence for one memory.",
    schema: memoryIdInput,
    execute: (input, services, principal) =>
      services.getMemoryHistory(String(input.memoryId), principal),
  }),
  memoryWriteAction({
    id: "memory.create",
    title: "Create memory",
    summary: "Save an attributed durable memory for future agents and chats.",
    schema: memoryCreateInput,
    execute: (input, services, principal, idempotencyKey) =>
      services.createMemory(
        { ...input, idempotencyKey, actionId: "memory.create" },
        principal,
      ),
  }),
  memoryWriteAction({
    id: "memory.revise",
    title: "Revise memory",
    summary: "Correct a memory with an expected revision and an audit reason.",
    schema: memoryReviseInput,
    execute: (input, services, principal, idempotencyKey) =>
      services.reviseMemory(
        { ...input, idempotencyKey, actionId: "memory.revise" },
        principal,
      ),
  }),
  memoryWriteAction({
    id: "memory.retire",
    title: "Retire memory",
    summary: "Mark a memory superseded while retaining its audit history.",
    schema: memoryRetireInput,
    execute: (input, services, principal, idempotencyKey) =>
      services.retireMemory(
        { ...input, idempotencyKey, actionId: "memory.retire" },
        principal,
      ),
  }),
  memoryWriteAction({
    id: "memory.delete",
    title: "Delete memory",
    summary: "Permanently delete one memory and its revisions.",
    schema: memoryIdInput,
    execute: (input, services, principal, idempotencyKey) =>
      services.deleteMemory(
        { ...input, idempotencyKey, actionId: "memory.delete" },
        principal,
      ),
  }),
  delegatedReadAction({
    id: "policy.list",
    title: "List policies",
    summary: "List reusable repository policies applied by Kody.",
    category: "policies",
    execute: (_input, services, principal) => services.listPolicies(principal),
  }),
  delegatedReadAction({
    id: "policy.get",
    title: "Get policy",
    summary: "Read one repository policy and its agent scope.",
    category: "policies",
    schema: getDefinitionInput,
    execute: (input, services, principal) =>
      services.getPolicy(String(input.id), principal),
  }),
  delegatedReadAction({
    id: "instruction.get",
    title: "Get repository instructions",
    summary: "Read the instructions shared by every Kody execution.",
    category: "instructions",
    execute: (_input, services, principal) =>
      services.getInstructions(principal),
  }),
  delegatedReadAction({
    id: "capability.list",
    title: "List capabilities",
    summary: "List reusable Kody capabilities available to this repository.",
    category: "capabilities",
    execute: (_input, services, principal) =>
      services.listCapabilities(principal),
  }),
  delegatedReadAction({
    id: "capability.get",
    title: "Get capability",
    summary: "Read one Kody capability contract and instructions.",
    category: "capabilities",
    schema: getDefinitionInput,
    execute: (input, services, principal) =>
      services.getCapability(String(input.id), principal),
  }),
  delegatedReadAction({
    id: "workflow.list",
    title: "List workflows",
    summary: "List Kody Engine workflows and their approval policy.",
    category: "workflows",
    execute: (_input, services, principal) => services.listWorkflows(principal),
  }),
  delegatedReadAction({
    id: "workflow.get",
    title: "Get workflow",
    summary: "Read one workflow definition and its runnable steps.",
    category: "workflows",
    schema: getDefinitionInput,
    execute: (input, services, principal) =>
      services.getWorkflow(String(input.id), principal),
  }),
  delegatedReadAction({
    id: "quality.gates.get",
    title: "Get quality gates",
    summary: "Read repository checks used by Kody Engine runs.",
    category: "quality",
    execute: (_input, services, principal) =>
      services.getQualityGates(principal),
  }),
  delegatedReadAction({
    id: "approval.list",
    title: "List approval requests",
    summary: "List safe approval status for agent-requested execution.",
    category: "approvals",
    schema: approvalListInput,
    execute: (input, services, principal) =>
      services.listApprovals(input, principal),
  }),
  delegatedReadAction({
    id: "approval.get",
    title: "Get approval request",
    summary: "Read one approval request without its signed approval secret.",
    category: "approvals",
    schema: approvalGetInput,
    execute: (input, services, principal) =>
      services.getApproval(String(input.requestId), principal),
  }),
  approvalRequestAction({
    id: "workflow.run.request",
    title: "Request workflow run",
    summary: "Ask the user to approve a Kody Engine workflow run.",
    schema: workflowRunInput,
    execute: (input, services, principal) =>
      services.requestWorkflowRun(input, principal),
  }),
  approvalRequestAction({
    id: "workflow.resume.request",
    title: "Request workflow resume",
    summary: "Ask the user to approve resuming a paused Kody Engine workflow.",
    schema: workflowResumeInput,
    execute: (input, services, principal) =>
      services.requestWorkflowResume(input, principal),
  }),
  approvalRequestAction({
    id: "capability.run.request",
    title: "Request capability run",
    summary: "Ask the user to approve a Kody Engine capability run.",
    schema: capabilityRunInput,
    execute: (input, services, principal) =>
      services.requestCapabilityRun(input, principal),
  }),
  delegatedReadAction({
    id: "schedule.list",
    title: "List schedules",
    summary: "List online Kody schedules for this repository.",
    category: "automation",
    execute: (_input, services, principal) => services.listSchedules(principal),
  }),
  delegatedReadAction({
    id: "schedule.get",
    title: "Get schedule",
    summary: "Read one online Kody schedule.",
    category: "automation",
    schema: getDefinitionInput,
    execute: (input, services, principal) =>
      services.getSchedule(String(input.id), principal),
  }),
  delegatedReadAction({
    id: "trigger.list",
    title: "List event triggers",
    summary: "List repository events that start Kody work.",
    category: "automation",
    execute: (_input, services, principal) => services.listTriggers(principal),
  }),
  delegatedReadAction({
    id: "trigger.get",
    title: "Get event trigger",
    summary: "Read one repository event trigger.",
    category: "automation",
    schema: getDefinitionInput,
    execute: (input, services, principal) =>
      services.getTrigger(String(input.id), principal),
  }),
  delegatedReadAction({
    id: "webhook.status",
    title: "Get webhook status",
    summary: "Inspect GitHub webhook delivery health.",
    category: "automation",
    execute: (_input, services, principal) =>
      services.getWebhookStatus(principal),
  }),
  delegatedReadAction({
    id: "notification.rule.list",
    title: "List notification rules",
    summary: "List online notification rules without secret channel values.",
    category: "notifications",
    execute: (_input, services, principal) =>
      services.listNotificationRules(principal),
  }),
  delegatedReadAction({
    id: "run.list",
    title: "List remote runs",
    summary: "Monitor recent Kody Engine and Agency runs.",
    category: "monitoring",
    schema: runListInput,
    execute: (input, services, principal) =>
      services.listRuns(input, principal),
  }),
  delegatedReadAction({
    id: "run.get",
    title: "Get remote run",
    summary: "Inspect one durable Kody run.",
    category: "monitoring",
    schema: runGetInput,
    execute: (input, services, principal) =>
      services.getRun(String(input.runId), principal),
  }),
  delegatedReadAction({
    id: "mcp.usage.get",
    title: "Get MCP usage",
    summary: "Read scoped request analytics, quota, and compatibility policy.",
    category: "monitoring",
    execute: (_input, services, principal) => services.getUsage(principal),
  }),
  approvalRequestAction({
    id: "schedule.save.request",
    title: "Request schedule save",
    summary: "Ask the user to approve creating or updating an online schedule.",
    schema: scheduleSaveInput,
    execute: (input, services, principal) =>
      services.requestScheduleSave(input, principal),
  }),
  approvalRequestAction({
    id: "schedule.delete.request",
    title: "Request schedule deletion",
    summary: "Ask the user to approve deleting an online schedule.",
    schema: automationDeleteInput,
    execute: (input, services, principal) =>
      services.requestScheduleDelete(input, principal),
  }),
  approvalRequestAction({
    id: "trigger.save.request",
    title: "Request trigger save",
    summary: "Ask the user to approve creating or updating an event trigger.",
    schema: triggerSaveInput,
    execute: (input, services, principal) =>
      services.requestTriggerSave(input, principal),
  }),
  approvalRequestAction({
    id: "trigger.delete.request",
    title: "Request trigger deletion",
    summary: "Ask the user to approve deleting an event trigger.",
    schema: automationDeleteInput,
    execute: (input, services, principal) =>
      services.requestTriggerDelete(input, principal),
  }),
  approvalRequestAction({
    id: "webhook.reconcile.request",
    title: "Request webhook repair",
    summary: "Ask the user to approve registering or repairing Kody's webhook.",
    schema: webhookReconcileInput,
    execute: (input, services, principal) =>
      services.requestWebhookReconcile(input, principal),
  }),
  approvalRequestAction({
    id: "notification.rule.create.request",
    title: "Request notification rule creation",
    summary:
      "Ask the user to approve creating an online notification rule. Secret channel values stay private.",
    schema: notificationRuleCreateInput,
    execute: (input, services, principal) =>
      services.requestNotificationRuleCreate(input, principal),
  }),
  approvalRequestAction({
    id: "notification.rule.delete.request",
    title: "Request notification rule deletion",
    summary: "Ask the user to approve deleting an online notification rule.",
    schema: automationDeleteInput,
    execute: (input, services, principal) =>
      services.requestNotificationRuleDelete(input, principal),
  }),
];

const ACTION_EXAMPLE_INPUTS: Readonly<Record<string, Record<string, unknown>>> =
  {
    "work.update": {
      recordId: "shared-work",
      expectedRevision: 1,
      status: "active",
      summary: "Implementation is in progress.",
    },
    "work.checkpoint.add": {
      recordId: "shared-work",
      expectedRevision: 1,
      summary: "The API contract is implemented.",
    },
    "work.evidence.add": {
      recordId: "shared-work",
      expectedRevision: 1,
      kind: "test",
      reference: "https://ci.example.test/runs/123",
      summary: "The integration tests passed.",
    },
    "work.decision.add": {
      recordId: "shared-work",
      expectedRevision: 1,
      summary: "Use the existing repository service.",
    },
    "work.handoff.create": {
      recordId: "shared-work",
      expectedRevision: 1,
      toAgent: "next-agent",
      summary: "The implementation is ready for verification.",
      nextSteps: ["Run the repository verification command."],
    },
    "work.artifact.add": {
      recordId: "shared-work",
      expectedRevision: 1,
      kind: "commit",
      reference: "abc123",
      summary: "Implementation commit.",
    },
    "memory.list": { scope: "all", limit: 20 },
    "memory.get": { memoryId: "memory-123" },
    "memory.search": { query: "architecture", scope: "all", limit: 10 },
    "memory.history": { memoryId: "memory-123" },
    "memory.create": {
      scope: "repository",
      kind: "decision",
      title: "Package manager",
      summary: "Use pnpm.",
      body: "This repository uses pnpm for installs and scripts.",
    },
    "memory.revise": {
      memoryId: "memory-123",
      expectedRevisionId: "revision-1",
      kind: "decision",
      title: "Package manager",
      summary: "Use pnpm.",
      body: "This repository uses pnpm for installs and scripts.",
    },
    "memory.retire": {
      memoryId: "memory-123",
      expectedRevisionId: "revision-1",
      reason: "The decision is no longer current.",
    },
    "memory.delete": { memoryId: "memory-123" },
    "policy.list": {},
    "policy.get": { id: "safe-changes" },
    "instruction.get": {},
    "capability.list": {},
    "capability.get": { id: "code-review" },
    "workflow.list": {},
    "workflow.get": { id: "quality-run" },
    "quality.gates.get": {},
    "approval.list": { status: "pending", limit: 20 },
    "approval.get": { requestId: "approval-123" },
    "workflow.run.request": {
      workflowId: "quality-run",
      workRecordId: "shared-work",
      input: {},
    },
    "workflow.resume.request": {
      workflowId: "quality-run",
      workRecordId: "shared-work",
      runId: "run-123",
    },
    "capability.run.request": {
      capabilityId: "code-review",
      workRecordId: "shared-work",
      input: {},
    },
    "schedule.list": {},
    "schedule.get": { id: "daily-quality" },
    "trigger.list": {},
    "trigger.get": { id: "pull-request-opened" },
    "webhook.status": {},
    "notification.rule.list": {},
    "run.list": { limit: 20 },
    "run.get": { runId: "run-123" },
    "mcp.usage.get": {},
    "schedule.save.request": {
      workRecordId: "shared-work",
      schedule: {
        id: "daily-quality",
        every: "1d",
        at: { time: "09:00", timezone: "Europe/London" },
        target: { kind: "workflow", id: "quality-run" },
        input: {},
        enabled: true,
      },
    },
    "schedule.delete.request": {
      workRecordId: "shared-work",
      id: "daily-quality",
    },
    "trigger.save.request": {
      workRecordId: "shared-work",
      trigger: { id: "pull-request-opened", event: "pull_request" },
    },
    "trigger.delete.request": {
      workRecordId: "shared-work",
      id: "pull-request-opened",
    },
    "webhook.reconcile.request": { workRecordId: "shared-work" },
    "notification.rule.create.request": {
      workRecordId: "shared-work",
      rule: {
        name: "Release failures",
        event: "release_failed",
        channel: { type: "web-push" },
      },
    },
    "notification.rule.delete.request": {
      workRecordId: "shared-work",
      id: "release-failures",
    },
  };

function publicAction(action: InternalAction): KodyAction {
  const { input: _input, execute: _execute, ...visible } = action;
  if (visible.examples.length > 0) return visible;
  const example = ACTION_EXAMPLE_INPUTS[action.id];
  return {
    ...visible,
    examples: example
      ? [{ input: example, description: `Example: ${action.summary}` }]
      : [],
  };
}

export function listKodyActions(): KodyAction[] {
  return INTERNAL_ACTIONS.map(publicAction);
}

export function getKodyAction(id: string): KodyAction | null {
  const action = INTERNAL_ACTIONS.find((candidate) => candidate.id === id);
  return action ? publicAction(action) : null;
}

export function isReadOnlyAction(action: KodyAction): boolean {
  return (
    action.permission === "read" &&
    action.sideEffects === false &&
    action.approval === "none"
  );
}

/** Rank catalog metadata, not repository resource contents. Partial word matches
 * keep natural-language queries useful without agent-specific routing rules. */
export function searchKodyActions(query = "", category?: string): KodyAction[] {
  const actions = listKodyActions().filter(
    (action) => !category || action.category === category,
  );
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
  const words = (value: string) =>
    new Set(
      (normalize(value).match(/[\p{L}\p{N}]+/gu) ?? []).map((word) =>
        word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
          ? word.slice(0, -1)
          : word,
      ),
    );
  const terms = words(query);
  if (!terms.size) return actions;
  return actions
    .map((action) => {
      const identity = words(`${action.id} ${action.title} ${action.category}`);
      const summary = words(action.summary);
      let score = normalize(action.id) === normalize(query.trim()) ? 1000 : 0;
      for (const term of terms)
        score += identity.has(term) ? 3 : summary.has(term) ? 1 : 0;
      return { action, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id))
    .map((entry) => entry.action);
}

export async function executeKodyAction(
  id: string,
  input: unknown,
  principal: McpPrincipal,
  context: ActionExecutionContext = {},
): Promise<unknown> {
  const action = INTERNAL_ACTIONS.find((candidate) => candidate.id === id);
  if (!action) throw new KodyActionError("action_not_found", "Unknown action.");
  if (context.readOnly && !isReadOnlyAction(action))
    throw new KodyActionError(
      "read_only_action_required",
      "This tool only accepts actions with read permission, no side effects, and no approval. Use kody_execute_tool for changes, subject to client approval and token scope.",
    );
  if (action.permission === "read" && !principal.scopes.includes("mcp:read"))
    throw new KodyActionError(
      "insufficient_scope",
      "The access token cannot read Kody data.",
    );
  if (action.permission !== "read" && !principal.scopes.includes("mcp:execute"))
    throw new KodyActionError(
      "insufficient_scope",
      "The access token cannot execute this action.",
    );
  const parsed = action.input.safeParse(input ?? {});
  if (!parsed.success)
    throw new KodyActionError(
      "invalid_input",
      "Action input is invalid.",
      parsed.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    );
  return await action.execute(
    parsed.data as Record<string, unknown>,
    principal,
    context,
  );
}

export class KodyActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Array<{
      path: string;
      code: string;
      message: string;
    }>,
  ) {
    super(message);
  }
}
