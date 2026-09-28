import { z } from "zod";

const actionResultSchema = z
  .object({
    journeySlug: z.string().trim().min(1).max(80).optional(),
    actionSlug: z.string().trim().min(1).max(80),
    actionName: z.string().trim().min(1).max(160),
    status: z.enum(["passed", "failed", "blocked"]),
    evidence: z.string().trim().min(1).max(2000),
    issueSource: z
      .enum(["none", "product", "test", "environment", "unknown"])
      .optional(),
    cause: z.string().trim().min(1).max(2000).optional(),
    correction: z.string().trim().min(1).max(2000).optional(),
    artifactPath: z.string().trim().min(1).max(2048),
  })
  .strict();

const journeyResultSchema = z
  .object({
    journeySlug: z.string().trim().min(1).max(80),
    journeyName: z.string().trim().min(1).max(160),
    status: z.enum(["passed", "failed", "blocked"]),
    evidence: z.string().trim().min(1).max(2000),
    issueSource: z
      .enum(["none", "product", "test", "environment", "unknown"])
      .optional(),
    cause: z.string().trim().min(1).max(2000).optional(),
    correction: z.string().trim().min(1).max(2000).optional(),
    artifactPath: z.string().trim().min(1).max(2048),
  })
  .strict();

const scenarioResultSchema = z
  .object({
    status: z.enum(["passed", "failed", "blocked"]),
    evidence: z.string().trim().min(1).max(2000),
    issueSource: z
      .enum(["none", "product", "test", "environment", "unknown"])
      .optional(),
    cause: z.string().trim().min(1).max(2000).optional(),
    correction: z.string().trim().min(1).max(2000).optional(),
    artifactPath: z.string().trim().min(1).max(2048),
  })
  .strict();

const resultSchema = z.object({
  journeyResults: z.array(journeyResultSchema).min(1).max(100).optional(),
  actionResults: z.array(actionResultSchema).min(1).max(100),
  scenarioResult: scenarioResultSchema,
});

type ResultStatus = "passed" | "failed" | "blocked";

export function verifyQualityResult(
  output: Record<string, unknown>,
  runId: string,
  expectedJourneys: Array<{
    slug: string;
    name: string;
    actions: Array<{ slug: string; name: string }>;
  }>,
) {
  const parsed = resultSchema.safeParse(output);
  if (!parsed.success) {
    return {
      result: null,
      error:
        "Quality result is missing the required Journey, Action, or Scenario results.",
    } as const;
  }
  const expectedActions = expectedJourneys.flatMap((journey) =>
    journey.actions.map((action) => ({ ...action, journeySlug: journey.slug })),
  );
  if (parsed.data.actionResults.length !== expectedActions.length) {
    return {
      result: null,
      error: `Quality result reported ${parsed.data.actionResults.length} Actions, but the Scenario contains ${expectedActions.length}.`,
    } as const;
  }

  const evidencePrefix = `test-results/quality-runs/${runId}/`;
  const reportedJourneyResults =
    parsed.data.journeyResults ??
    (expectedJourneys.length === 1
      ? [
          {
            journeySlug: expectedJourneys[0]!.slug,
            journeyName: expectedJourneys[0]!.name,
            ...parsed.data.scenarioResult,
          },
        ]
      : []);
  if (reportedJourneyResults.length !== expectedJourneys.length) {
    return {
      result: null,
      error: `Quality result reported ${reportedJourneyResults.length} Journeys, but the Scenario contains ${expectedJourneys.length}.`,
    } as const;
  }
  for (const [index, result] of reportedJourneyResults.entries()) {
    if (!result.artifactPath.startsWith(evidencePrefix)) {
      return {
        result: null,
        error: `Quality evidence for Journey ${index + 1} is not inside this run.`,
      } as const;
    }
  }
  for (const [index, result] of parsed.data.actionResults.entries()) {
    const expected = expectedActions[index];
    if (!expected || !result.artifactPath.startsWith(evidencePrefix)) {
      return {
        result: null,
        error: `Quality evidence for Action ${index + 1} is not inside this run.`,
      } as const;
    }
  }
  if (!parsed.data.scenarioResult.artifactPath.startsWith(evidencePrefix)) {
    return {
      result: null,
      error: "Quality evidence for the Scenario is not inside this run.",
    } as const;
  }

  const passed = parsed.data.actionResults.filter(
    (result) => result.status === "passed",
  ).length;
  const failed = parsed.data.actionResults.filter(
    (result) => result.status === "failed",
  ).length;
  const blocked = parsed.data.actionResults.filter(
    (result) => result.status === "blocked",
  ).length;
  const statuses = [
    ...reportedJourneyResults.map((result) => result.status),
    ...parsed.data.actionResults.map((result) => result.status),
    parsed.data.scenarioResult.status,
  ];
  const status: ResultStatus = statuses.includes("failed")
    ? "failed"
    : statuses.includes("blocked")
      ? "blocked"
      : "passed";

  const actionResults = parsed.data.actionResults.map((result, index) => ({
    ...result,
    journeySlug: expectedActions[index]!.journeySlug,
    actionSlug: expectedActions[index]!.slug,
    actionName: expectedActions[index]!.name,
  }));
  const journeyResults = reportedJourneyResults.map((result, index) => ({
    ...result,
    journeySlug: expectedJourneys[index]!.slug,
    journeyName: expectedJourneys[index]!.name,
  }));

  return {
    result: {
      ...parsed.data,
      journeyResults,
      actionResults,
      passed,
      failed,
      blocked,
      status,
    },
    error: null,
  } as const;
}
