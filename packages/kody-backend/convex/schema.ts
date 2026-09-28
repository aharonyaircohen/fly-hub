import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  connectionValidator,
  companyIntentValidator,
  inboxEntryValidator,
  intentDecisionValidator,
  macroValidator,
  workflowDefinitionValidator,
  workflowRunStateValidator,
  pipelineDefinitionValidator,
  pipelineRunStatusValidator,
  pipelineRunStepValidator,
  guidedFlowStatusValidator,
} from "./validators";
import {
  agentIdentityValidator,
  conversationAttachmentValidator,
  conversationEntryValidator,
  conversationRuntimeValidator,
  conversationTurnProgressValidator,
  conversationTurnRecoveryValidator,
  machineAccessValidator,
  conversationScopeValidator,
} from "./conversationValidators";
import {
  memoryValidator,
  memoryActorValidator,
  memoryEvidenceValidator,
  memoryStatusValidator,
  storedMemoryKindValidator,
} from "./memoryValidators";
import { storedAgencyRunSubjectTypeValidator } from "./agencyValidators";

// Every table is partitioned by `tenantId` ("owner/name" of the connected consumer
// tenantId) — the same scope the GitHub backend serves today. Per-user rows add
// `login`. Flexible payloads stay v.any() so brand-defined shapes keep working;
// invariant fields are typed.
export default defineSchema({
  memoryWriteReceipts: defineTable({
    tenantId: v.string(),
    actorKind: v.string(),
    actorId: v.string(),
    key: v.string(),
    hash: v.string(),
    memoryId: v.string(),
    memory: v.optional(memoryValidator),
    deleted: v.boolean(),
    expiresAt: v.number(),
  })
    .index("by_request", ["tenantId", "actorKind", "actorId", "key"])
    .index("by_memory", ["memoryId"]),
  memories: defineTable({
    memoryId: v.string(),
    scopeKind: v.union(v.literal("user"), v.literal("repository")),
    scopeId: v.string(),
    kind: storedMemoryKindValidator,
    title: v.string(),
    summary: v.string(),
    body: v.string(),
    searchText: v.string(),
    currentRevisionId: v.string(),
    status: memoryStatusValidator,
    createdAt: v.string(),
    updatedAt: v.string(),
    expiresAt: v.optional(v.string()),
  })
    .index("by_memory", ["memoryId"])
    .index("by_scope_status", ["scopeKind", "scopeId", "status", "updatedAt"])
    .searchIndex("search_memory", {
      searchField: "searchText",
      filterFields: ["scopeKind", "scopeId", "status", "kind"],
    }),

  memoryRevisions: defineTable({
    revisionId: v.string(),
    memoryId: v.string(),
    previousRevisionId: v.union(v.string(), v.null()),
    kind: storedMemoryKindValidator,
    title: v.string(),
    summary: v.string(),
    body: v.string(),
    evidence: v.array(memoryEvidenceValidator),
    reason: v.string(),
    actor: memoryActorValidator,
    createdAt: v.string(),
  })
    .index("by_revision", ["revisionId"])
    .index("by_memory", ["memoryId", "createdAt"]),

  memoryLearningRuns: defineTable({
    tenantId: v.string(),
    sourceRunId: v.string(),
    claimedBy: v.string(),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    claimedAt: v.string(),
    leaseUntil: v.string(),
    completedAt: v.optional(v.string()),
    failure: v.optional(v.string()),
  })
    .index("by_source", ["tenantId", "sourceRunId"])
    .index("by_status", ["tenantId", "status", "claimedAt"]),

  workflows: defineTable({
    tenantId: v.string(),
    workflowId: v.string(),
    definition: workflowDefinitionValidator,
    source: v.union(v.literal("local"), v.literal("store")),
    updatedAt: v.string(),
  }).index("by_tenant", ["tenantId", "workflowId"]),

  connections: defineTable({
    tenantId: v.string(),
    connection: connectionValidator,
  }).index("by_tenant", ["tenantId", "connection.id"]),

  workflowRuns: defineTable({
    tenantId: v.string(),
    workflowId: v.string(),
    runId: v.string(),
    state: workflowRunStateValidator,
    updatedAt: v.string(),
  })
    .index("by_run", ["tenantId", "workflowId", "runId"])
    .index("by_workflow", ["tenantId", "workflowId"]),

  workflowRunLeases: defineTable({
    tenantId: v.string(),
    workflowId: v.string(),
    runId: v.string(),
    ownerId: v.string(),
    expiresAtMs: v.number(),
    updatedAtMs: v.number(),
  }).index("by_run", ["tenantId", "workflowId", "runId"]),

  browserSessions: defineTable({
    tenantId: v.string(),
    actorId: v.string(),
    sessionId: v.string(),
    providerId: v.string(),
    appName: v.string(),
    machineId: v.string(),
    state: v.union(
      v.literal("starting"),
      v.literal("running"),
      v.literal("suspended"),
      v.literal("failed"),
    ),
    currentUrl: v.string(),
    viewport: v.object({ width: v.number(), height: v.number() }),
    createdAtMs: v.number(),
    lastActiveAtMs: v.number(),
    expiresAtMs: v.number(),
  })
    .index("by_actor", ["tenantId", "actorId"])
    .index("by_session", ["tenantId", "actorId", "sessionId"])
    .index("by_expiry", ["expiresAtMs"]),

  browserSessionStartLeases: defineTable({
    tenantId: v.string(),
    actorId: v.string(),
    ownerId: v.string(),
    leaseUntilMs: v.number(),
  }).index("by_actor", ["tenantId", "actorId"]),

  workflowEventDeliveries: defineTable({
    tenantId: v.string(),
    deliveryId: v.string(),
    triggerId: v.string(),
    workflowId: v.string(),
    eventName: v.string(),
    requestId: v.string(),
    // Optional so existing deliveries remain readable during deployment.
    sourceEventId: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    input: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("dispatched"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    error: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_key", ["tenantId", "deliveryId", "triggerId"])
    .index("by_source_key", ["tenantId", "sourceEventId", "triggerId"])
    .index("by_status", ["tenantId", "status", "updatedAt"])
    .index("by_tenant", ["tenantId", "updatedAt"]),

  pipelines: defineTable({
    tenantId: v.string(),
    pipelineId: v.string(),
    definition: pipelineDefinitionValidator,
    source: v.union(v.literal("local"), v.literal("store")),
    updatedAt: v.string(),
  }).index("by_tenant", ["tenantId", "pipelineId"]),

  pipelineRuns: defineTable({
    tenantId: v.string(),
    pipelineId: v.string(),
    runId: v.string(),
    concurrencyKey: v.optional(v.string()),
    status: pipelineRunStatusValidator,
    input: v.optional(v.record(v.string(), v.any())),
    facts: v.optional(v.record(v.string(), v.any())),
    steps: v.array(pipelineRunStepValidator),
    currentStepIndex: v.number(),
    activeWorkflowRunId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_run", ["tenantId", "pipelineId", "runId"])
    .index("by_pipeline", ["tenantId", "pipelineId", "updatedAt"])
    .index("by_concurrency", [
      "tenantId",
      "pipelineId",
      "concurrencyKey",
      "status",
    ])
    .index("by_active_workflow", ["tenantId", "activeWorkflowRunId"]),

  guidedFlowInstances: defineTable({
    tenantId: v.string(),
    actorId: v.string(),
    instanceId: v.string(),
    instanceKey: v.optional(v.string()),
    rootFlowId: v.optional(v.string()),
    activeKey: v.optional(v.string()),
    flowId: v.string(),
    flowVersion: v.number(),
    currentStepId: v.string(),
    status: guidedFlowStatusValidator,
    revision: v.number(),
    data: v.any(),
    output: v.optional(v.any()),
    history: v.array(v.string()),
    stack: v.optional(
      v.array(
        v.object({
          flowId: v.string(),
          flowVersion: v.number(),
          currentStepId: v.string(),
          data: v.any(),
          history: v.array(v.string()),
        }),
      ),
    ),
    updatedAt: v.string(),
    mutationId: v.optional(v.string()),
  })
    .index("by_instance", ["tenantId", "actorId", "instanceId"])
    .index("by_actor_status", ["tenantId", "actorId", "status"])
    .index("by_active_key", ["tenantId", "actorId", "activeKey", "status"]),

  guidedFlowSubmissions: defineTable({
    tenantId: v.string(),
    actorId: v.string(),
    instanceId: v.string(),
    revision: v.number(),
    mutationId: v.string(),
    flowId: v.string(),
    flowVersion: v.number(),
    stepId: v.string(),
    actionId: v.string(),
    result: v.any(),
    submittedAt: v.string(),
  })
    .index("by_instance_revision", [
      "tenantId",
      "actorId",
      "instanceId",
      "revision",
    ])
    .index("by_instance_mutation", [
      "tenantId",
      "actorId",
      "instanceId",
      "mutationId",
    ]),

  guidedFlowBindings: defineTable({
    tenantId: v.string(),
    actorId: v.string(),
    conversationId: v.string(),
    instanceId: v.string(),
    updatedAt: v.string(),
  })
    .index("by_conversation", ["tenantId", "actorId", "conversationId"])
    .index("by_instance", ["tenantId", "actorId", "instanceId"]),

  // Tenant widget bundles — precompiled browser components published from
  // the tenant repo (source/review in GitHub, serving copy here). One row
  // per published version; latest non-null wins.
  widgets: defineTable({
    tenantId: v.string(),
    name: v.optional(v.string()),
    slug: v.string(),
    version: v.number(),
    bundle: v.string(),
    commitSha: v.optional(v.string()),
    updatedAt: v.string(),
  }).index("by_widget", ["tenantId", "slug", "version"]),

  // Custom GuidedFlow definitions — one row per flow version (append-only;
  // deletes append an archived tombstone version). Replaces the former
  // userState "guided-flow-definitions" blob array.
  guidedFlowDefinitions: defineTable({
    tenantId: v.string(),
    // Legacy rows may still have actorId; all new definitions are shared by
    // the repository tenant and omit it.
    actorId: v.optional(v.string()),
    flowId: v.string(),
    version: v.number(),
    archived: v.optional(v.boolean()),
    definition: v.any(),
    updatedAt: v.string(),
  })
    .index("by_flow", ["tenantId", "flowId", "version"])
    .index("by_tenant", ["tenantId"]),

  // Append-only ledger of finished guided flows — one row per completed
  // instance, the per-user progress record (e.g. lesson completions).
  guidedFlowCompletions: defineTable({
    tenantId: v.string(),
    actorId: v.string(),
    instanceId: v.string(),
    flowId: v.string(),
    flowVersion: v.number(),
    completedAt: v.string(),
    data: v.any(),
  })
    .index("by_completion", ["tenantId", "actorId", "instanceId"])
    .index("by_actor", ["tenantId", "actorId", "completedAt"])
    .index("by_flow", ["tenantId", "flowId", "completedAt"]),

  // Durable consumer work emitted by a committed flow transition. Generic
  // GuidedFlow state is saved first; consumer adapters claim these effects
  // afterward and mark them complete idempotently.
  guidedFlowEffects: defineTable({
    tenantId: v.string(),
    actorId: v.string(),
    instanceId: v.string(),
    effectId: v.string(),
    flowId: v.string(),
    flowVersion: v.number(),
    action: v.optional(v.string()),
    data: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_effect", ["tenantId", "actorId", "effectId"])
    .index("by_instance_status", [
      "tenantId",
      "actorId",
      "instanceId",
      "status",
    ]),

  userJourneys: defineTable({
    tenantId: v.string(),
    journeyId: v.string(),
    name: v.string(),
    goal: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("archived"),
    ),
    priority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("normal"),
    ),
    currentVersion: v.number(),
    updatedAt: v.string(),
  }).index("by_tenant", ["tenantId", "journeyId"]),

  userJourneyVersions: defineTable({
    tenantId: v.string(),
    journeyId: v.string(),
    version: v.number(),
    definition: v.any(),
    createdAt: v.string(),
  }).index("by_journey", ["tenantId", "journeyId", "version"]),

  userJourneyRuns: defineTable({
    tenantId: v.string(),
    journeyId: v.string(),
    runId: v.string(),
    version: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("passed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    environment: v.string(),
    commitSha: v.optional(v.string()),
    runnerVersion: v.optional(v.string()),
    startedAt: v.optional(v.string()),
    finishedAt: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_journey", ["tenantId", "journeyId", "createdAt"])
    .index("by_run", ["tenantId", "runId"]),

  userJourneyRunEvents: defineTable({
    tenantId: v.string(),
    runId: v.string(),
    seq: v.number(),
    event: v.any(),
    time: v.string(),
    idempotencyKey: v.optional(v.string()),
  })
    .index("by_run", ["tenantId", "runId", "seq"])
    .index("by_idempotency", ["tenantId", "runId", "idempotencyKey"]),

  agencyRuns: defineTable({
    tenantId: v.string(),
    runId: v.string(),
    subjectType: storedAgencyRunSubjectTypeValidator,
    subjectId: v.string(),
    run: v.any(),
    updatedAt: v.string(),
  })
    .index("by_run", ["tenantId", "runId"])
    .index("by_tenant", ["tenantId", "updatedAt"]),

  runEvents: defineTable({
    tenantId: v.string(),
    runId: v.string(),
    seq: v.number(),
    event: v.any(),
    time: v.string(),
    idempotencyKey: v.optional(v.string()),
  })
    .index("by_run", ["tenantId", "runId", "seq"])
    .index("by_idempotency", ["tenantId", "runId", "idempotencyKey"]),

  manifests: defineTable({
    tenantId: v.string(),
    kind: v.string(),
    doc: v.any(),
    updatedAt: v.string(),
  }).index("by_kind", ["tenantId", "kind"]),

  chatEvents: defineTable({
    tenantId: v.string(),
    sessionId: v.string(),
    seq: v.number(),
    event: v.any(),
    idempotencyKey: v.optional(v.string()),
  })
    .index("by_session", ["tenantId", "sessionId", "seq"])
    // Tenant-wide newest-first scans (Activity feed's recent-session list) —
    // the implicit _creationTime suffix orders events by arrival.
    .index("by_tenant", ["tenantId"])
    .index("by_idempotency", ["tenantId", "sessionId", "idempotencyKey"]),

  conversations: defineTable({
    tenantId: v.string(),
    conversationId: v.string(),
    surface: v.optional(
      v.union(v.literal("global"), v.literal("vibe-default")),
    ),
    scope: conversationScopeValidator,
    title: v.string(),
    preview: v.optional(v.string()),
    pinned: v.boolean(),
    activeAgent: agentIdentityValidator,
    runtime: conversationRuntimeValidator,
    machineAccess: v.optional(machineAccessValidator),
    createdBy: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_conversation", ["tenantId", "conversationId"])
    .index("by_tenant_updated", ["tenantId", "updatedAt"]),

  conversationEntries: defineTable({
    tenantId: v.string(),
    conversationId: v.string(),
    entryId: v.string(),
    idempotencyKey: v.string(),
    seq: v.number(),
    entry: conversationEntryValidator,
    updatedAt: v.string(),
  })
    .index("by_conversation", ["tenantId", "conversationId", "seq"])
    .index("by_entry", ["tenantId", "conversationId", "entryId"])
    .index("by_idempotency", ["tenantId", "conversationId", "idempotencyKey"]),

  conversationTurns: defineTable({
    tenantId: v.string(),
    conversationId: v.string(),
    turnId: v.string(),
    backend: v.union(
      v.literal("direct"),
      v.literal("brain"),
      v.literal("engine"),
      v.literal("live"),
    ),
    agent: agentIdentityValidator,
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    assistantEntryId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorDetail: v.optional(v.string()),
    progress: v.optional(conversationTurnProgressValidator),
    recovery: v.optional(conversationTurnRecoveryValidator),
    startedAt: v.string(),
    completedAt: v.optional(v.string()),
    updatedAt: v.string(),
  })
    .index("by_turn", ["tenantId", "conversationId", "turnId"])
    .index("by_conversation", ["tenantId", "conversationId", "startedAt"]),

  conversationCheckpoints: defineTable({
    tenantId: v.string(),
    conversationId: v.string(),
    version: v.number(),
    throughSeq: v.number(),
    agentEpochId: v.string(),
    summary: v.string(),
    sourceHash: v.string(),
    createdAt: v.string(),
  }).index("by_conversation", ["tenantId", "conversationId", "version"]),

  conversationRuntimeBindings: defineTable({
    tenantId: v.string(),
    conversationId: v.string(),
    runtimeKind: v.union(
      v.literal("direct"),
      v.literal("brain"),
      v.literal("engine"),
      v.literal("live"),
    ),
    runtime: conversationRuntimeValidator,
    remoteConversationId: v.string(),
    updatedAt: v.string(),
  }).index("by_conversation_runtime", [
    "tenantId",
    "conversationId",
    "runtimeKind",
  ]),

  conversationAttachments: defineTable({
    tenantId: v.string(),
    conversationId: v.string(),
    attachmentId: v.string(),
    attachment: conversationAttachmentValidator,
  })
    .index("by_conversation", ["tenantId", "conversationId"])
    .index("by_attachment", ["tenantId", "conversationId", "attachmentId"]),

  intents: defineTable({
    tenantId: v.string(),
    intentId: v.string(),
    intent: companyIntentValidator,
    updatedAt: v.string(),
  }).index("by_tenant", ["tenantId", "intentId"]),

  intentDecisions: defineTable({
    tenantId: v.string(),
    intentId: v.string(),
    seq: v.number(),
    decision: intentDecisionValidator,
    idempotencyKey: v.optional(v.string()),
  })
    .index("by_intent", ["tenantId", "intentId", "seq"])
    .index("by_idempotency", ["tenantId", "intentId", "idempotencyKey"]),

  agencyDispatches: defineTable({
    tenantId: v.string(),
    idempotencyKey: v.string(),
    loopId: v.string(),
    decision: v.any(),
    status: v.union(
      v.literal("skipped"),
      v.literal("reserved"),
      v.literal("waiting-approval"),
      v.literal("waiting-capacity"),
      v.literal("dispatched"),
      v.literal("failed"),
      v.literal("dead-letter"),
    ),
    leaseUntil: v.optional(v.string()),
    reservationId: v.optional(v.string()),
    correlationId: v.optional(v.string()),
    policyHash: v.optional(v.string()),
    effectivePolicy: v.optional(v.any()),
    definitionRefs: v.optional(v.array(v.any())),
    approvalId: v.optional(v.string()),
    runId: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_tenant_key", ["tenantId", "idempotencyKey"])
    .index("by_policy_status", ["tenantId", "policyHash", "status"]),

  loopWakeRegistrations: defineTable({
    tenantId: v.string(),
    loopId: v.string(),
    trigger: v.optional(v.any()),
    nextDueAt: v.optional(v.string()),
    updatedAt: v.string(),
  })
    .index("by_loop", ["tenantId", "loopId"])
    .index("by_tenant", ["tenantId"])
    .index("by_next_due", ["nextDueAt"]),

  loopWakeReceipts: defineTable({
    wakeId: v.string(),
    tenantId: v.string(),
    slot: v.string(),
    loopId: v.optional(v.string()),
    scheduledFor: v.optional(v.string()),
    attempt: v.optional(v.number()),
    status: v.union(
      v.literal("reserved"),
      v.literal("accepted"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("shadow"),
      v.literal("dispatched"),
      v.literal("failed"),
      v.literal("timed_out"),
    ),
    detail: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_wake", ["tenantId", "wakeId"])
    .index("by_tenant", ["tenantId", "createdAt"])
    .index("by_status", ["status", "updatedAt"]),

  agencyApprovals: defineTable({
    tenantId: v.string(),
    approvalId: v.string(),
    scopeKind: v.union(
      v.literal("loop"),
      v.literal("pipeline"),
      v.literal("workflow"),
      v.literal("capability"),
    ),
    scopeId: v.string(),
    action: v.string(),
    status: v.union(
      v.literal("available"),
      v.literal("consumed"),
      v.literal("revoked"),
    ),
    approvedBy: v.string(),
    approvedAt: v.string(),
    expiresAt: v.optional(v.string()),
    consumedAt: v.optional(v.string()),
    dispatchKey: v.optional(v.string()),
  })
    .index("by_approval_id", ["tenantId", "approvalId"])
    .index("by_scope", ["tenantId", "scopeKind", "scopeId", "status"])
    .index("by_tenant", ["tenantId", "approvedAt"]),

  apps: defineTable({
    tenantId: v.string(),
    appId: v.string(),
    name: v.string(),
    slug: v.string(),
    repository: v.string(),
    branch: v.string(),
    rootDirectory: v.string(),
    detectedConfig: v.any(),
    desiredStatus: v.union(
      v.literal("running"),
      v.literal("stopped"),
      v.literal("deleted"),
    ),
    observedStatus: v.union(
      v.literal("provisioning"),
      v.literal("deploying"),
      v.literal("running"),
      v.literal("sleeping"),
      v.literal("stopped"),
      v.literal("unhealthy"),
      v.literal("failed"),
      v.literal("deleting"),
      v.literal("deleted"),
    ),
    provider: v.any(),
    exposure: v.union(v.literal("private"), v.literal("public")),
    accessTokens: v.array(
      v.object({
        tokenId: v.string(),
        name: v.string(),
        tokenHash: v.string(),
        createdAt: v.string(),
        lastUsedAt: v.optional(v.string()),
        revokedAt: v.optional(v.string()),
      }),
    ),
    currentDeploymentId: v.optional(v.string()),
    currentAction: v.optional(
      v.object({
        requestId: v.string(),
        action: v.string(),
        startedAt: v.string(),
      }),
    ),
    secretNames: v.array(v.string()),
    domains: v.array(v.any()),
    storage: v.array(v.any()),
    createdBy: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_slug", ["tenantId", "slug"])
    .index("by_app", ["tenantId", "appId"])
    .index("by_tenant", ["tenantId", "updatedAt"]),

  appDeployments: defineTable({
    tenantId: v.string(),
    appId: v.string(),
    deploymentId: v.string(),
    requestId: v.string(),
    commitSha: v.string(),
    buildPlan: v.any(),
    imageRef: v.optional(v.string()),
    builderMachineId: v.optional(v.string()),
    runtimeMachineId: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("building"),
      v.literal("releasing"),
      v.literal("verifying"),
      v.literal("running"),
      v.literal("failed"),
      v.literal("superseded"),
      v.literal("rolled_back"),
    ),
    stages: v.array(v.any()),
    error: v.optional(v.any()),
    requestedBy: v.string(),
    callbackTokenHash: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
    completedAt: v.optional(v.string()),
  })
    .index("by_deployment", ["tenantId", "appId", "deploymentId"])
    .index("by_request", ["tenantId", "appId", "requestId"])
    .index("by_tenant_request", ["tenantId", "requestId"])
    .index("by_app", ["tenantId", "appId", "createdAt"]),

  appEvents: defineTable({
    tenantId: v.string(),
    appId: v.string(),
    eventId: v.string(),
    kind: v.string(),
    actor: v.any(),
    payload: v.any(),
    timestamp: v.string(),
  })
    .index("by_event", ["tenantId", "appId", "eventId"])
    .index("by_app", ["tenantId", "appId", "timestamp"]),

  reports: defineTable({
    tenantId: v.string(),
    slug: v.string(),
    runId: v.optional(v.string()), // absent = top-level report doc
    title: v.optional(v.string()),
    body: v.string(),
    meta: v.any(), // producer, capabilitySlug, reportType…
    updatedAt: v.string(),
  })
    .index("by_slug", ["tenantId", "slug", "runId"])
    .index("by_tenant", ["tenantId"]),

  agents: defineTable({
    tenantId: v.string(),
    slug: v.string(),
    frontmatter: v.any(),
    body: v.string(),
    updatedAt: v.string(),
  }).index("by_tenant", ["tenantId", "slug"]),

  // Legacy-compatible catalog records. Runtime definitions use the versioned
  // definition tables below; Store activation may still populate catalog
  // entries while older consumers transition.
  catalog: defineTable({
    tenantId: v.string(),
    category: v.union(
      v.literal("config"),
      v.literal("capability"),
      v.literal("agent"),
      v.literal("goal-template"),
      v.literal("workflow-template"),
      v.literal("capability-workflow"),
    ),
    slug: v.string(),
    doc: v.any(),
    source: v.string(),
    sourceUpdatedAt: v.optional(v.string()),
    updatedAt: v.string(),
  }).index("by_key", ["tenantId", "category", "slug"]),

  definitionHeads: defineTable({
    tenantId: v.string(),
    kind: v.union(
      v.literal("agent"),
      v.literal("capability"),
      v.literal("goal"),
      v.literal("implementation"),
      v.literal("asset"),
    ),
    slug: v.string(),
    version: v.string(),
    bundle: v.any(),
    source: v.optional(v.union(v.literal("local"), v.literal("store"))),
    updatedAt: v.string(),
  }).index("by_key", ["tenantId", "kind", "slug"]),

  definitionVersions: defineTable({
    tenantId: v.string(),
    kind: v.union(
      v.literal("agent"),
      v.literal("capability"),
      v.literal("goal"),
      v.literal("implementation"),
      v.literal("asset"),
    ),
    slug: v.string(),
    version: v.string(),
    bundle: v.any(),
    source: v.optional(v.union(v.literal("local"), v.literal("store"))),
    createdAt: v.string(),
  })
    .index("by_version", ["tenantId", "kind", "slug", "version"])
    .index("by_definition", ["tenantId", "kind", "slug", "createdAt"]),

  viewRenderers: defineTable({
    tenantId: v.string(),
    slug: v.string(),
    // Optional only so pre-versioning rows remain readable during migration.
    version: v.optional(v.number()),
    archived: v.optional(v.boolean()),
    definition: v.any(),
    updatedAt: v.string(),
  })
    .index("by_tenant", ["tenantId", "slug"])
    .index("by_renderer", ["tenantId", "slug", "version"]),

  macros: defineTable({
    tenantId: v.string(),
    macroId: v.string(),
    macro: macroValidator,
  }).index("by_tenant", ["tenantId", "macroId"]),

  // Singleton per-tenant documents: dashboard.json, system-prompt.md, kody
  // context/instruction docs — keyed by `kind`.
  repoDocs: defineTable({
    tenantId: v.string(),
    kind: v.string(), // "dashboard-config" | "system-prompt" | "instructions" | "cto" | "context:<slug>" …
    doc: v.any(),
    updatedAt: v.string(),
  }).index("by_kind", ["tenantId", "kind"]),

  // One-time delegated Brand Chat launch assertions. Expired rows are removed
  // opportunistically by the consume mutation so replay protection works
  // across every server instance without an unbounded ledger.
  clientLaunchNonces: defineTable({
    tenantId: v.string(),
    tokenId: v.string(),
    expiresAt: v.number(),
  })
    .index("by_token", ["tenantId", "tokenId"])
    .index("by_expiry", ["expiresAt"]),

  clientLaunchRateLimits: defineTable({
    key: v.string(),
    windowStartedAt: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  userState: defineTable({
    tenantId: v.string(),
    namespace: v.string(),
    userKey: v.string(),
    data: v.any(),
    updatedAt: v.string(),
  }).index("by_user", ["tenantId", "namespace", "userKey"]),

  userPreferences: defineTable({
    namespace: v.string(),
    userKey: v.string(),
    data: v.any(),
    updatedAt: v.string(),
  }).index("by_user", ["namespace", "userKey"]),

  brainRestoreJobs: defineTable({
    userId: v.string(),
    githubAccount: v.optional(v.string()),
    githubOwner: v.optional(v.string()),
    githubTokenEncrypted: v.optional(v.string()),
    operationId: v.string(),
    imageRef: v.string(),
    reset: v.boolean(),
    dashboardUrl: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    leaseId: v.optional(v.string()),
    leaseUntilMs: v.optional(v.number()),
    createdAt: v.string(),
    updatedAt: v.string(),
    error: v.optional(v.string()),
  })
    .index("by_operation", ["operationId"])
    .index("by_status", ["status"]),

  repositoryPreferences: defineTable({
    tenantId: v.string(),
    namespace: v.string(),
    data: v.any(),
    updatedAt: v.string(),
  }).index("by_repository", ["tenantId", "namespace"]),

  userCredentials: defineTable({
    userKey: v.string(),
    name: v.string(),
    encryptedValue: v.string(),
    updatedAt: v.string(),
  })
    .index("by_user", ["userKey"])
    .index("by_user_name", ["userKey", "name"]),

  mcpAccessTokens: defineTable({
    tokenId: v.string(),
    tokenHash: v.string(),
    name: v.string(),
    tenantId: v.string(),
    actorLogin: v.string(),
    actorGithubId: v.number(),
    scopes: v.array(v.string()),
    createdAt: v.string(),
    expiresAt: v.string(),
    revokedAt: v.optional(v.string()),
  })
    .index("by_hash", ["tokenHash"])
    .index("by_token", ["tenantId", "tokenId"])
    .index("by_actor", ["tenantId", "actorLogin", "createdAt"]),

  mcpRateLimits: defineTable({
    key: v.string(),
    windowStartedAt: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  mcpAuditEvents: defineTable({
    eventId: v.string(),
    tenantId: v.string(),
    runId: v.optional(v.string()),
    tokenId: v.string(),
    actorLogin: v.string(),
    method: v.string(),
    toolName: v.optional(v.string()),
    actionId: v.optional(v.string()),
    outcome: v.union(
      v.literal("success"),
      v.literal("rejected"),
      v.literal("error"),
    ),
    occurredAt: v.string(),
  })
    .index("by_event", ["tenantId", "eventId"])
    .index("by_tenant", ["tenantId", "occurredAt"])
    .index("by_run", ["tenantId", "runId", "occurredAt"]),

  agentRuns: defineTable({
    runId: v.string(),
    tenantId: v.string(),
    tokenId: v.string(),
    agentName: v.string(),
    clientName: v.optional(v.string()),
    workRecordId: v.optional(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    callCount: v.number(),
    lastOutcome: v.optional(
      v.union(v.literal("success"), v.literal("rejected"), v.literal("error")),
    ),
    startedAt: v.string(),
    lastActivityAt: v.string(),
    endedAt: v.optional(v.string()),
  })
    .index("by_run", ["tenantId", "runId"])
    .index("by_tenant", ["tenantId", "startedAt"]),

  notificationPrefs: defineTable({
    tenantId: v.string(),
    login: v.string(),
    prefs: v.any(),
    updatedAt: v.string(),
  }).index("by_login", ["tenantId", "login"]),

  inboxEntries: defineTable({
    tenantId: v.string(),
    login: v.string(),
    entryId: v.string(),
    entry: inboxEntryValidator,
    readAt: v.optional(v.string()),
    sentAt: v.string(),
  })
    .index("by_login", ["tenantId", "login", "sentAt"])
    .index("by_entry", ["tenantId", "login", "entryId"]),

  channelsSeen: defineTable({
    tenantId: v.string(),
    login: v.string(),
    manifest: v.any(), // ChannelsSeenManifest
    updatedAt: v.string(),
  }).index("by_login", ["tenantId", "login"]),

  agencyRecords: defineTable({
    tenantId: v.string(),
    kind: v.union(
      v.literal("observation"),
      v.literal("finding"),
      v.literal("learning"),
    ),
    recordId: v.string(),
    doc: v.any(),
    updatedAt: v.string(),
  }).index("by_tenant", ["tenantId", "kind", "recordId"]),

  blueprintInstallations: defineTable({
    tenantId: v.string(),
    blueprintId: v.string(),
    blueprintVersion: v.string(),
    status: v.union(
      v.literal("installing"),
      v.literal("active"),
      v.literal("blocked"),
    ),
    requestId: v.string(),
    maintainerId: v.optional(v.string()),
    evidence: v.array(v.string()),
    updatedAt: v.string(),
  }).index("by_blueprint", ["tenantId", "blueprintId"]),

  taskState: defineTable({
    tenantId: v.string(),
    taskKey: v.string(), // "2", "issues/2", "prs/3"
    kind: v.string(), // "context" | "state" | …
    doc: v.any(),
    updatedAt: v.string(),
  })
    .index("by_task", ["tenantId", "taskKey", "kind"])
    .index("by_kind", ["tenantId", "kind", "updatedAt"]),

  mcpApprovalRequests: defineTable({
    tenantId: v.string(),
    requestId: v.string(),
    workRecordId: v.string(),
    targetKind: v.union(
      v.literal("workflow"),
      v.literal("capability"),
      v.literal("automation"),
    ),
    workflowId: v.string(),
    runId: v.string(),
    mode: v.union(v.literal("start"), v.literal("resume")),
    input: v.any(),
    action: v.string(),
    approvalId: v.string(),
    approvalToken: v.string(),
    actor: v.object({
      tokenId: v.string(),
      name: v.string(),
      actorLogin: v.string(),
      actorGithubId: v.number(),
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("approving"),
      v.literal("rejected"),
      v.literal("dispatched"),
      v.literal("failed"),
      v.literal("expired"),
    ),
    idempotencyKey: v.string(),
    requestHash: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
    expiresAt: v.string(),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.string()),
    result: v.optional(v.any()),
  })
    .index("by_request", ["tenantId", "requestId"])
    .index("by_tenant", ["tenantId", "createdAt"])
    .index("by_work", ["tenantId", "workRecordId", "createdAt"])
    .index("by_idempotency", ["tenantId", "actor.tokenId", "idempotencyKey"]),

  capabilityState: defineTable({
    tenantId: v.string(),
    slug: v.string(),
    state: v.any(),
    updatedAt: v.string(),
  }).index("by_tenant", ["tenantId", "slug"]),

  agentStates: defineTable({
    tenantId: v.string(),
    agent: v.string(),
    state: v.any(),
    updatedAt: v.string(),
  }).index("by_agent", ["tenantId", "agent"]),

  // Daily append-only streams (activity/<date>.jsonl, events/log/<date>.jsonl).
  dailyLogs: defineTable({
    tenantId: v.string(),
    stream: v.union(
      v.literal("activity"),
      v.literal("events"),
      v.literal("flyActivity"),
    ),
    date: v.string(), // YYYY-MM-DD
    seq: v.number(),
    entry: v.any(),
    idempotencyKey: v.optional(v.string()),
  })
    .index("by_stream", ["tenantId", "stream", "date", "seq"])
    .index("by_idempotency", ["tenantId", "stream", "date", "idempotencyKey"]),

  qualityActions: defineTable({
    tenantId: v.string(),
    slug: v.string(),
    name: v.string(),
    outcome: v.string(),
    area: v.string(),
    steps: v.optional(
      v.array(
        v.union(
          v.object({ operation: v.literal("open"), path: v.string() }),
          v.object({ operation: v.literal("click"), target: v.string() }),
          v.object({
            operation: v.literal("fill"),
            target: v.string(),
            value: v.string(),
          }),
          v.object({
            operation: v.literal("fill"),
            target: v.string(),
            valueFrom: v.literal("github-test-token"),
          }),
          v.object({ operation: v.literal("reload") }),
          v.object({ operation: v.literal("check"), text: v.string() }),
        ),
      ),
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("archived"),
    ),
    updatedAt: v.string(),
  }).index("by_tenant", ["tenantId", "slug"]),

  qualityJourneys: defineTable({
    tenantId: v.string(),
    slug: v.string(),
    name: v.string(),
    goal: v.string(),
    priority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("normal"),
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("archived"),
    ),
    actionSlugs: v.array(v.string()),
    updatedAt: v.string(),
  }).index("by_tenant", ["tenantId", "slug"]),

  qualityScenarios: defineTable({
    tenantId: v.string(),
    slug: v.string(),
    journeySlug: v.optional(v.string()),
    journeySlugs: v.optional(v.array(v.string())),
    name: v.string(),
    kind: v.union(
      v.literal("happy"),
      v.literal("validation"),
      v.literal("permission"),
      v.literal("failure"),
      v.literal("recovery"),
      v.literal("persistence"),
    ),
    given: v.string(),
    expectedVisible: v.string(),
    expectedState: v.string(),
    environmentId: v.optional(v.string()),
    testId: v.optional(v.string()),
    cleanup: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("archived"),
    ),
    updatedAt: v.string(),
  })
    .index("by_tenant", ["tenantId", "slug"])
    .index("by_journey", ["tenantId", "journeySlug", "slug"]),

  qualityRuns: defineTable({
    tenantId: v.string(),
    runId: v.string(),
    runSlug: v.string(),
    journeySlug: v.optional(v.string()),
    journeySlugs: v.optional(v.array(v.string())),
    scenarioSlug: v.string(),
    environment: v.string(),
    targetUrl: v.string(),
    sourceCommit: v.string(),
    definitionUpdatedAt: v.string(),
    retryOfRunId: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("passed"),
      v.literal("failed"),
      v.literal("blocked"),
      v.literal("cancelled"),
    ),
    startedAt: v.optional(v.string()),
    finishedAt: v.optional(v.string()),
    error: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_tenant", ["tenantId", "createdAt"])
    .index("by_run", ["tenantId", "runId"])
    .index("by_scenario", ["tenantId", "scenarioSlug", "createdAt"]),

  qualityRunEvents: defineTable({
    tenantId: v.string(),
    runId: v.string(),
    seq: v.number(),
    idempotencyKey: v.string(),
    event: v.any(),
    time: v.string(),
  })
    .index("by_run", ["tenantId", "runId", "seq"])
    .index("by_idempotency", ["tenantId", "runId", "idempotencyKey"]),

  // Global (cross-repo) Kody engine store — replaces the Kody-Dashboard repo
  // action-state.json / event-log.jsonl.
  actionStates: defineTable({
    runId: v.string(),
    state: v.any(), // ActionState
    updatedAt: v.string(),
  }).index("by_run", ["runId"]),

  eventLog: defineTable({
    entryId: v.string(),
    runId: v.string(),
    event: v.string(),
    payload: v.any(),
    channel: v.optional(v.string()),
    emittedAt: v.string(),
  })
    .index("by_run", ["runId"])
    .index("by_emitted", ["emittedAt"]),
});
