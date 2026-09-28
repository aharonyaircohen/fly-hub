/** Backend table metadata used by database-native backup and restore. */
export interface TableDef {
  table: string;
  naturalKey: string[];
  upsertIndex?: string;
  global?: boolean;
  /** Runtime coordination data that must not be backed up or restored. */
  transient?: boolean;
  /** Exactly one row may exist per tenant; tenantId is the complete identity. */
  tenantSingleton?: boolean;
}

export const TABLES: readonly TableDef[] = [
  { table: "apps", naturalKey: ["appId"], upsertIndex: "by_app" },
  {
    table: "appDeployments",
    naturalKey: ["appId", "deploymentId"],
    upsertIndex: "by_deployment",
  },
  {
    table: "appEvents",
    naturalKey: ["appId", "eventId"],
    upsertIndex: "by_event",
  },
  {
    table: "definitionHeads",
    naturalKey: ["kind", "slug"],
    upsertIndex: "by_key",
  },
  {
    table: "definitionVersions",
    naturalKey: ["kind", "slug", "version"],
    upsertIndex: "by_version",
  },
  { table: "catalog", naturalKey: ["category", "slug"], upsertIndex: "by_key" },
  { table: "workflows", naturalKey: ["workflowId"], upsertIndex: "by_tenant" },
  {
    table: "connections",
    naturalKey: ["connection.id"],
    upsertIndex: "by_tenant",
  },
  {
    table: "workflowRuns",
    naturalKey: ["workflowId", "runId"],
    upsertIndex: "by_run",
  },
  {
    table: "workflowRunLeases",
    naturalKey: ["workflowId", "runId"],
    upsertIndex: "by_run",
    transient: true,
  },
  {
    table: "browserSessions",
    naturalKey: ["actorId", "sessionId"],
    upsertIndex: "by_session",
    transient: true,
  },
  {
    table: "browserSessionStartLeases",
    naturalKey: ["actorId"],
    upsertIndex: "by_actor",
    transient: true,
  },
  {
    table: "workflowEventDeliveries",
    naturalKey: ["deliveryId", "triggerId"],
    upsertIndex: "by_key",
  },
  { table: "pipelines", naturalKey: ["pipelineId"], upsertIndex: "by_tenant" },
  {
    table: "pipelineRuns",
    naturalKey: ["pipelineId", "runId"],
    upsertIndex: "by_run",
  },
  {
    table: "guidedFlowInstances",
    naturalKey: ["actorId", "instanceId"],
    upsertIndex: "by_instance",
  },
  {
    table: "guidedFlowCompletions",
    naturalKey: ["actorId", "instanceId"],
    upsertIndex: "by_completion",
  },
  {
    table: "guidedFlowSubmissions",
    naturalKey: ["actorId", "instanceId", "revision"],
    upsertIndex: "by_instance_revision",
  },
  {
    table: "guidedFlowBindings",
    naturalKey: ["actorId", "conversationId"],
    upsertIndex: "by_conversation",
  },
  {
    table: "guidedFlowDefinitions",
    naturalKey: ["flowId", "version"],
    upsertIndex: "by_flow",
  },
  {
    table: "guidedFlowEffects",
    naturalKey: ["actorId", "effectId"],
    upsertIndex: "by_effect",
  },
  {
    table: "userJourneys",
    naturalKey: ["journeyId"],
    upsertIndex: "by_tenant",
  },
  {
    table: "userJourneyVersions",
    naturalKey: ["journeyId", "version"],
    upsertIndex: "by_journey",
  },
  {
    table: "userJourneyRuns",
    naturalKey: ["runId"],
    upsertIndex: "by_run",
  },
  {
    table: "userJourneyRunEvents",
    naturalKey: ["runId", "seq"],
    upsertIndex: "by_run",
  },
  { table: "qualityActions", naturalKey: ["slug"], upsertIndex: "by_tenant" },
  { table: "qualityJourneys", naturalKey: ["slug"], upsertIndex: "by_tenant" },
  { table: "qualityScenarios", naturalKey: ["slug"], upsertIndex: "by_tenant" },
  { table: "qualityRuns", naturalKey: ["runId"], upsertIndex: "by_run" },
  {
    table: "qualityRunEvents",
    naturalKey: ["runId", "seq"],
    upsertIndex: "by_run",
  },
  {
    table: "chatEvents",
    naturalKey: ["sessionId", "seq"],
    upsertIndex: "by_session",
  },
  {
    table: "conversations",
    naturalKey: ["conversationId"],
    upsertIndex: "by_conversation",
  },
  {
    table: "conversationEntries",
    naturalKey: ["conversationId", "entryId"],
    upsertIndex: "by_entry",
  },
  {
    table: "conversationTurns",
    naturalKey: ["conversationId", "turnId"],
    upsertIndex: "by_turn",
  },
  {
    table: "conversationCheckpoints",
    naturalKey: ["conversationId", "version"],
    upsertIndex: "by_conversation",
  },
  {
    table: "conversationRuntimeBindings",
    naturalKey: ["conversationId", "runtimeKind"],
    upsertIndex: "by_conversation_runtime",
  },
  {
    table: "conversationAttachments",
    naturalKey: ["conversationId", "attachmentId"],
    upsertIndex: "by_attachment",
  },
  {
    table: "agencyDispatches",
    naturalKey: ["idempotencyKey"],
    upsertIndex: "by_tenant_key",
  },
  {
    table: "loopWakeRegistrations",
    naturalKey: ["loopId"],
    upsertIndex: "by_loop",
    transient: true,
  },
  {
    table: "loopWakeReceipts",
    naturalKey: ["wakeId"],
    upsertIndex: "by_wake",
    transient: true,
  },
  {
    table: "brainRestoreJobs",
    naturalKey: ["operationId"],
    upsertIndex: "by_operation",
    global: true,
    transient: true,
  },
  {
    table: "agencyApprovals",
    naturalKey: ["approvalId"],
    upsertIndex: "by_approval_id",
  },
  { table: "reports", naturalKey: ["slug", "runId"], upsertIndex: "by_slug" },
  { table: "agents", naturalKey: ["slug"], upsertIndex: "by_tenant" },
  {
    table: "viewRenderers",
    naturalKey: ["slug", "version"],
    upsertIndex: "by_renderer",
  },
  {
    table: "widgets",
    naturalKey: ["slug", "version"],
    upsertIndex: "by_widget",
  },
  { table: "macros", naturalKey: ["macroId"], upsertIndex: "by_tenant" },
  { table: "repoDocs", naturalKey: ["kind"], upsertIndex: "by_kind" },
  {
    table: "clientLaunchNonces",
    naturalKey: ["tokenId"],
    upsertIndex: "by_token",
  },
  {
    table: "clientLaunchRateLimits",
    naturalKey: ["key"],
    upsertIndex: "by_key",
    global: true,
  },
  {
    table: "memories",
    naturalKey: ["memoryId"],
    upsertIndex: "by_memory",
    global: true,
  },
  {
    table: "memoryRevisions",
    naturalKey: ["revisionId"],
    upsertIndex: "by_revision",
    global: true,
  },
  {
    table: "memoryLearningRuns",
    naturalKey: ["sourceRunId"],
    upsertIndex: "by_source",
  },
  {
    table: "memoryWriteReceipts",
    naturalKey: ["actorKind", "actorId", "key"],
    upsertIndex: "by_request",
  },
  { table: "intents", naturalKey: ["intentId"], upsertIndex: "by_tenant" },
  {
    table: "intentDecisions",
    naturalKey: ["intentId", "seq"],
    upsertIndex: "by_intent",
  },
  {
    table: "notificationPrefs",
    naturalKey: ["login"],
    upsertIndex: "by_login",
  },
  {
    table: "userState",
    naturalKey: ["namespace", "userKey"],
    upsertIndex: "by_user",
  },
  {
    table: "userPreferences",
    naturalKey: ["namespace", "userKey"],
    upsertIndex: "by_user",
    global: true,
  },
  {
    table: "repositoryPreferences",
    naturalKey: ["namespace"],
    upsertIndex: "by_repository",
  },
  {
    table: "userCredentials",
    naturalKey: ["userKey", "name"],
    upsertIndex: "by_user_name",
    global: true,
  },
  {
    table: "agencyRecords",
    naturalKey: ["kind", "recordId"],
    upsertIndex: "by_tenant",
  },
  {
    table: "blueprintInstallations",
    naturalKey: ["blueprintId"],
    upsertIndex: "by_blueprint",
  },
  {
    table: "taskState",
    naturalKey: ["taskKey", "kind"],
    upsertIndex: "by_task",
  },
  {
    table: "mcpApprovalRequests",
    naturalKey: ["requestId"],
    upsertIndex: "by_request",
    transient: true,
  },
  {
    table: "mcpAccessTokens",
    naturalKey: ["tokenId"],
    upsertIndex: "by_token",
    transient: true,
  },
  {
    table: "mcpRateLimits",
    naturalKey: ["key"],
    upsertIndex: "by_key",
    global: true,
    transient: true,
  },
  {
    table: "mcpAuditEvents",
    naturalKey: ["eventId"],
    upsertIndex: "by_event",
  },
  {
    table: "agentRuns",
    naturalKey: ["runId"],
    upsertIndex: "by_run",
  },
  { table: "capabilityState", naturalKey: ["slug"], upsertIndex: "by_tenant" },
  { table: "agentStates", naturalKey: ["agent"], upsertIndex: "by_agent" },
  {
    table: "dailyLogs",
    naturalKey: ["stream", "date", "seq"],
    upsertIndex: "by_stream",
  },
  { table: "agencyRuns", naturalKey: ["runId"], upsertIndex: "by_run" },
  { table: "runEvents", naturalKey: ["runId", "seq"], upsertIndex: "by_run" },
  { table: "manifests", naturalKey: ["kind"], upsertIndex: "by_kind" },
  {
    table: "inboxEntries",
    naturalKey: ["login", "entryId"],
    upsertIndex: "by_entry",
  },
  { table: "channelsSeen", naturalKey: ["login"], upsertIndex: "by_login" },
  {
    table: "actionStates",
    naturalKey: ["runId"],
    upsertIndex: "by_run",
    global: true,
  },
  { table: "eventLog", naturalKey: ["entryId"], global: true },
];

export const IMPORTABLE_TABLES: readonly string[] = TABLES.filter(
  (entry) => !entry.transient,
).map((entry) => entry.table);

/** Tables whose rows belong to one repository and are safe to back up or restore there. */
export const REPO_SCOPED_TABLES: readonly string[] = TABLES.filter(
  (entry) => !entry.global && !entry.transient,
).map((entry) => entry.table);
