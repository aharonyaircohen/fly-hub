import { v } from "convex/values";

export const connectionValidator = v.object({
  id: v.string(),
  name: v.string(),
  provider: v.string(),
  accountType: v.string(),
  externalId: v.string(),
  credentialRefs: v.object({ accessToken: v.string() }),
  status: v.union(
    v.literal("connected"),
    v.literal("needs_attention"),
    v.literal("disabled"),
  ),
  verifiedAt: v.union(v.string(), v.null()),
});

// Shared document validators — the DB-enforced contract for stable platform
// shapes. Brand-defined / open payloads (user-state data, repo docs, view
// renderer definitions, event payloads, chat meta) intentionally stay v.any().

export const workflowTransitionValidator = v.object({
  to: v.string(),
  // Dashboard sends structured condition objects; legacy rows may hold strings.
  when: v.optional(v.union(v.string(), v.record(v.string(), v.any()))),
  default: v.optional(v.boolean()),
  maxIterations: v.optional(v.number()),
});

export const workflowStepValidator = v.object({
  id: v.string(),
  capability: v.string(),
  input: v.optional(v.any()),
  action: v.optional(v.string()),
  evidence: v.optional(v.string()),
  target: v.optional(v.union(v.literal("issue"), v.literal("pr"))),
  delivery: v.optional(v.literal("pull-request")),
  targetFact: v.optional(v.string()),
  reason: v.optional(v.string()),
  timeoutSeconds: v.optional(v.number()),
  approval: v.optional(v.literal("required")),
  inputs: v.optional(v.record(v.string(), v.object({ from: v.string() }))),
  next: v.optional(v.array(workflowTransitionValidator)),
  runWhen: v.optional(v.record(v.string(), v.any())),
  continueOn: v.optional(v.array(v.string())),
  saveReport: v.optional(v.boolean()),
  report: v.optional(v.record(v.string(), v.any())),
});

export const workflowDefinitionValidator = v.object({
  name: v.string(),
  agent: v.string(),
  capabilities: v.optional(v.array(v.string())),
  // JSON Schema is an open, nested document validated at the Workflow boundary.
  inputSchema: v.optional(v.any()),
  startAt: v.optional(v.string()),
  steps: v.optional(v.array(workflowStepValidator)),
  // Engine-owned workflow summary publication policy.
  report: v.optional(v.record(v.string(), v.any())),
  runWithoutApproval: v.optional(v.boolean()),
  createdAt: v.optional(v.string()),
  updatedAt: v.optional(v.string()),
});

export const pipelineStepValidator = v.object({
  id: v.string(),
  workflow: v.string(),
  inputMap: v.optional(v.record(v.string(), v.string())),
  decisionFact: v.optional(v.string()),
});

export const pipelineDefinitionValidator = v.object({
  name: v.string(),
  inputSchema: v.optional(v.any()),
  steps: v.array(pipelineStepValidator),
  runWithoutApproval: v.optional(v.boolean()),
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const pipelineRunStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("blocked"),
  v.literal("waiting-approval"),
  v.literal("cancelled"),
);

export const pipelineRunStepStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("blocked"),
  v.literal("cancelled"),
);

export const pipelineRunStepValidator = v.object({
  id: v.string(),
  workflowId: v.string(),
  inputMap: v.optional(v.record(v.string(), v.string())),
  decisionFact: v.optional(v.string()),
  status: pipelineRunStepStatusValidator,
  workflowRunId: v.optional(v.string()),
  startedAt: v.optional(v.string()),
  completedAt: v.optional(v.string()),
  output: v.optional(v.record(v.string(), v.any())),
});

export const workflowRunStatusValidator = v.union(
  v.literal("running"),
  v.literal("waiting-approval"),
  v.literal("blocked"),
  v.literal("failed"),
  v.literal("done"),
);

const tokenBreakdownValidator = v.object({
  input: v.number(),
  output: v.number(),
  cacheRead: v.number(),
  cacheCreate: v.number(),
  total: v.number(),
});

const usageMeasurementValidator = v.union(
  v.literal("reported"),
  v.literal("partial"),
  v.literal("unknown"),
);

const modelRunUsageValidator = v.object({
  tokens: tokenBreakdownValidator,
  costUsd: v.number(),
  agentRuns: v.number(),
  turns: v.number(),
  measurement: usageMeasurementValidator,
});

const runUsageValidator = v.object({
  version: v.literal(1),
  tokens: tokenBreakdownValidator,
  costUsd: v.number(),
  agentRuns: v.number(),
  turns: v.number(),
  measurement: usageMeasurementValidator,
  byModel: v.record(v.string(), modelRunUsageValidator),
});

export const workflowRunStateValidator = v.object({
  status: workflowRunStatusValidator,
  input: v.optional(v.record(v.string(), v.any())),
  definitionHash: v.optional(v.string()),
  currentStepId: v.optional(v.string()),
  completedStepIds: v.array(v.string()),
  approval: v.optional(
    v.object({
      stepId: v.string(),
      action: v.string(),
      contextHash: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("consumed"),
      ),
      approvedAt: v.optional(v.string()),
      approvedBy: v.optional(v.string()),
    }),
  ),
  transitionCounts: v.optional(v.record(v.string(), v.number())),
  steps: v.optional(
    v.record(
      v.string(),
      v.object({
        capability: v.optional(v.string()),
        status: v.union(
          v.literal("running"),
          v.literal("completed"),
          v.literal("blocked"),
          v.literal("failed"),
        ),
        input: v.optional(v.any()),
        output: v.optional(v.any()),
        startedAt: v.optional(v.string()),
        completedAt: v.optional(v.string()),
      }),
    ),
  ),
  facts: v.optional(v.record(v.string(), v.any())),
  evidence: v.optional(v.record(v.string(), v.boolean())),
  artifacts: v.optional(
    v.array(
      v.object({
        label: v.string(),
        url: v.optional(v.string()),
        path: v.optional(v.string()),
      }),
    ),
  ),
  usage: v.optional(runUsageValidator),
  blocker: v.optional(v.string()),
});

export const guidedFlowStatusValidator = v.union(
  v.literal("active"),
  v.literal("completed"),
  v.literal("cancelled"),
);

export const macroValidator = v.object({
  id: v.string(),
  name: v.string(),
  // Dashboard stamps Unix-ms numbers; legacy rows may hold ISO strings.
  createdAt: v.optional(v.union(v.number(), v.string())),
  steps: v.optional(v.array(v.any())),
});

export const releaseCadenceValidator = v.union(
  v.literal("manual"),
  v.literal("15m"),
  v.literal("1d"),
  v.literal("1w"),
);

const intentControlsValidator = v.object({
  release: v.optional(
    v.object({
      cadence: v.optional(releaseCadenceValidator),
      qaDepth: v.optional(
        v.union(v.literal("light"), v.literal("standard"), v.literal("strict")),
      ),
      blockerLevel: v.optional(
        v.union(v.literal("low"), v.literal("standard"), v.literal("strict")),
      ),
      approval: v.optional(
        v.union(
          v.literal("none"),
          v.literal("before-production"),
          v.literal("before-risky-actions"),
        ),
      ),
    }),
  ),
  automation: v.object({
    authority: v.literal("full-auto"),
    maxDailyActions: v.number(),
    maxConcurrentGoals: v.optional(v.number()),
    requiresHumanFor: v.array(v.string()),
  }),
});

const companyIntentBase = {
  version: v.literal(1),
  id: v.string(),
  status: v.union(
    v.literal("active"),
    v.literal("paused"),
    v.literal("archived"),
  ),
  for: v.string(),
  description: v.optional(v.string()),
  priority: v.number(),
  posture: v.union(
    v.literal("confidence"),
    v.literal("speed"),
    v.literal("stability-recovery"),
    v.literal("maintenance"),
    v.literal("balanced"),
  ),
  scope: v.object({ repos: v.array(v.string()), areas: v.array(v.string()) }),
  manager: v.optional(
    v.object({
      agent: v.string(),
      capability: v.string(),
      loop: v.string(),
      reviewEvery: v.string(),
    }),
  ),
  principles: v.array(v.string()),
  metrics: v.array(v.string()),
  portfolio: v.object({
    loops: v.array(v.string()),
    capabilities: v.array(v.string()),
    goals: v.optional(v.array(v.string())),
  }),
  createdAt: v.string(),
  updatedAt: v.string(),
};

export const companyIntentValidator = v.union(
  v.object({
    ...companyIntentBase,
    policyRefs: v.array(v.string()),
    controls: intentControlsValidator,
  }),
  v.object({
    ...companyIntentBase,
    policy: intentControlsValidator,
  }),
);

export const intentDecisionValidator = v.object({
  at: v.string(),
  agent: v.string(),
  intentId: v.optional(v.string()),
  action: v.string(),
  reason: v.string(),
  before: v.optional(v.any()),
  after: v.optional(v.any()),
  resources: v.optional(v.array(v.string())),
});

export const inboxEntryValidator = v.object({
  id: v.string(),
  source: v.union(
    v.literal("mention"),
    v.literal("comment"),
    v.literal("review_requested"),
    v.literal("assigned"),
    v.literal("team_mention"),
    v.literal("subscribed"),
    v.literal("request"),
    v.literal("kody"),
    v.literal("other"),
  ),
  repoFullName: v.string(),
  threadType: v.string(),
  title: v.string(),
  snippet: v.string(),
  author: v.optional(v.string()),
  url: v.string(),
  sentAt: v.string(),
  readAt: v.union(v.string(), v.null()),
  ctoAction: v.optional(v.string()),
  ctoCommand: v.optional(v.string()),
  ctoAgent: v.optional(v.string()),
  ctoCapability: v.optional(v.string()),
  pipelineApproval: v.optional(
    v.object({
      pipelineId: v.string(),
      runId: v.string(),
      issue: v.optional(v.number()),
    }),
  ),
  ctoRepo: v.optional(v.string()),
  category: v.optional(v.string()),
});
