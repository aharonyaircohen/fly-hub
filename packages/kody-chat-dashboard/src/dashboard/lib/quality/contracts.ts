import { z } from "zod";

export const qualityStatusSchema = z.enum(["draft", "active", "archived"]);
export const qualityPrioritySchema = z.enum(["critical", "high", "normal"]);
export const scenarioKindSchema = z.enum([
  "happy",
  "validation",
  "permission",
  "failure",
  "recovery",
  "persistence",
]);
export const qualityRunStatusSchema = z.enum([
  "queued",
  "running",
  "passed",
  "failed",
  "blocked",
  "cancelled",
]);
export const qualityUsageMeasurementSchema = z.enum([
  "reported",
  "partial",
  "unknown",
]);

const qualityTokenBreakdownSchema = z.object({
  input: z.number().finite().nonnegative(),
  output: z.number().finite().nonnegative(),
  cacheRead: z.number().finite().nonnegative(),
  cacheCreate: z.number().finite().nonnegative(),
  total: z.number().finite().nonnegative(),
});

const qualityModelUsageSchema = z.object({
  tokens: qualityTokenBreakdownSchema,
  costUsd: z.number().finite().nonnegative(),
  agentRuns: z.number().finite().nonnegative(),
  turns: z.number().finite().nonnegative(),
  measurement: qualityUsageMeasurementSchema,
});

export const qualityRunUsageSchema = qualityModelUsageSchema.extend({
  version: z.literal(1),
  byModel: z.record(z.string().min(1), qualityModelUsageSchema),
});

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const timestampSchema = z.string().datetime();

export const actionSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(160),
  outcome: z.string().trim().min(1).max(2000),
  area: z.string().trim().min(1).max(120),
  status: qualityStatusSchema,
  updatedAt: timestampSchema,
});

export const journeySchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(160),
  goal: z.string().trim().min(1).max(2000),
  priority: qualityPrioritySchema,
  status: qualityStatusSchema,
  actionSlugs: z.array(slugSchema).max(100),
  updatedAt: timestampSchema,
});

const scenarioObjectSchema = z.object({
  slug: slugSchema,
  journeySlugs: z.array(slugSchema).min(1).max(100),
  name: z.string().trim().min(1).max(160),
  kind: scenarioKindSchema,
  given: z.string().trim().min(1).max(4000),
  expectedVisible: z.string().trim().min(1).max(4000),
  expectedState: z.string().trim().min(1).max(4000),
  environmentId: slugSchema.optional(),
  cleanup: z.string().trim().max(4000).optional(),
  status: qualityStatusSchema,
  updatedAt: timestampSchema,
});

function normalizeScenarioJourneys(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.journeySlugs) &&
    typeof record.journeySlug === "string"
  ) {
    const { journeySlug, ...rest } = record;
    return { ...rest, journeySlugs: [journeySlug] };
  }
  return value;
}

const readableScenarioObjectSchema = scenarioObjectSchema.superRefine(
  (scenario, context) => {
    if (new Set(scenario.journeySlugs).size !== scenario.journeySlugs.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["journeySlugs"],
        message: "A Journey can appear only once in a Scenario",
      });
    }
  },
);

export const scenarioRecordSchema = z.preprocess(
  normalizeScenarioJourneys,
  readableScenarioObjectSchema,
);

export const scenarioSchema = z.preprocess(
  normalizeScenarioJourneys,
  readableScenarioObjectSchema.superRefine((scenario, context) => {
    if (scenario.status === "active" && !scenario.environmentId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["environmentId"],
        message: "Active Scenarios require a repository environment",
      });
    }
  }),
);

export type QualityAction = z.infer<typeof actionSchema>;
export type QualityJourney = z.infer<typeof journeySchema>;
export type QualityScenario = z.infer<typeof scenarioSchema>;
export type QualityRunStatus = z.infer<typeof qualityRunStatusSchema>;
export type QualityRunUsage = z.infer<typeof qualityRunUsageSchema>;
export type QualityHealth =
  | "uncovered"
  | "never_run"
  | "running"
  | "passing"
  | "failing"
  | "blocked"
  | "stale";

export function qualityRunHealth(input: {
  scenarioStatus: QualityScenario["status"];
  scenarioUpdatedAt: string;
  latestRun: {
    status: QualityRunStatus;
    definitionUpdatedAt: string;
    sourceCommit: string;
  } | null;
  targetCommit?: string | null;
  hasTest?: boolean;
}): QualityHealth {
  if (input.scenarioStatus === "active" && input.hasTest === false) {
    return "uncovered";
  }
  if (!input.latestRun) return "never_run";
  if (
    input.scenarioUpdatedAt > input.latestRun.definitionUpdatedAt ||
    (input.targetCommit && input.latestRun.sourceCommit !== input.targetCommit)
  ) {
    return "stale";
  }
  if (
    input.latestRun.status === "queued" ||
    input.latestRun.status === "running"
  ) {
    return "running";
  }
  if (input.latestRun.status === "passed") return "passing";
  if (input.latestRun.status === "blocked") return "blocked";
  if (input.latestRun.status === "failed") return "failing";
  return "never_run";
}
