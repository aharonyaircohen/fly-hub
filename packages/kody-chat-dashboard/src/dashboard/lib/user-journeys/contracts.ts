import { z } from "zod";

const locatorSchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("role"), role: z.string().min(1), name: z.string().min(1).optional() }),
  z.object({ by: z.literal("label"), label: z.string().min(1) }),
  z.object({ by: z.literal("text"), text: z.string().min(1) }),
  z.object({ by: z.literal("testId"), testId: z.string().min(1) }),
]);

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("click"), locator: locatorSchema }),
  z.object({ type: z.literal("fill"), locator: locatorSchema, value: z.string().max(10000) }),
  z.object({ type: z.literal("select"), locator: locatorSchema, value: z.string().min(1).max(1000) }),
  z.object({ type: z.literal("check"), locator: locatorSchema, checked: z.boolean() }),
  z.object({ type: z.literal("reload") }),
]);

const assertionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("visible"), locator: locatorSchema }),
  z.object({ type: z.literal("hidden"), locator: locatorSchema }),
  z.object({ type: z.literal("text"), locator: locatorSchema, value: z.string().min(1).max(10000) }),
  z.object({ type: z.literal("url"), value: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("enabled"), locator: locatorSchema, enabled: z.boolean() }),
  z.object({ type: z.literal("request"), method: z.string().regex(/^[A-Z]+$/), url: z.string().min(1), status: z.number().int().min(100).max(599) }),
  z.object({ type: z.literal("noConsoleErrors") }),
]);

const stepSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  explanation: z.string().max(2000).optional(),
  action: actionSchema,
  assertions: z.array(assertionSchema).min(1).max(20),
});

const scenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  name: z.string().min(1).max(160),
  kind: z.enum(["happy", "validation", "failure", "recovery", "persistence", "permissions"]),
  steps: z.array(stepSchema).min(1).max(100),
});

export const journeyDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  name: z.string().min(1).max(160),
  goal: z.string().min(1).max(2000),
  status: z.enum(["draft", "active", "archived"]),
  priority: z.enum(["critical", "high", "normal"]),
  scenarios: z.array(scenarioSchema).min(1).max(50),
});

export type JourneyDefinition = z.infer<typeof journeyDefinitionSchema>;
export type JourneyAction = z.infer<typeof actionSchema>;
export type JourneyAssertion = z.infer<typeof assertionSchema>;
export type JourneyLocator = z.infer<typeof locatorSchema>;
export type JourneyScenario = z.infer<typeof scenarioSchema>;

export type JourneyRunSummary = {
  status: "queued" | "running" | "passed" | "failed" | "cancelled";
  version: number;
};

export type JourneyHealth = "never_run" | "running" | "passed" | "failed" | "flaky";

export function journeyStatusFromRuns(runs: readonly JourneyRunSummary[]): JourneyHealth {
  if (runs.length === 0) return "never_run";
  const latest = runs[0];
  if (latest.status === "queued" || latest.status === "running") return "running";
  if (latest.status === "failed") {
    const recent = runs.slice(0, 5);
    return recent.some((run) => run.status === "passed") ? "flaky" : "failed";
  }
  return latest.status === "passed" ? "passed" : "never_run";
}
