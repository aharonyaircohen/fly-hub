import { tool } from "ai";
import { z } from "zod";

import { workflowStepDefinitionSchema } from "../../../../../src/dashboard/lib/workflow-definitions";

const id = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,127}$/);
const capabilitySlug = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const asset = z.object({ path: z.string().min(1), content: z.string() });
const capability = z.object({
  slug: capabilitySlug,
  instructions: z.string().trim().min(1).max(50_000),
  contract: z.object({
    execution: z.enum(["agent", "script"]).default("agent"),
    secrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).optional(),
    timeoutMs: z.number().int().min(1_000).max(21_600_000).optional(),
    input: z.record(z.string(), z.unknown()).default({}),
    output: z.record(z.string(), z.unknown()).default({}),
  }),
  skills: z.array(asset).default([]),
  tools: z.array(asset).default([]),
});
const workflow = z.object({
  id,
  name: z.string().trim().min(1).max(160),
  agent: capabilitySlug.default("kody"),
  capabilities: z.array(capabilitySlug).min(1),
  inputSchema: z.record(z.string(), z.unknown()).default({}),
  startAt: id.optional(),
  steps: z.array(workflowStepDefinitionSchema).min(1),
  report: z.record(z.string(), z.unknown()).optional(),
  runWithoutApproval: z.boolean().default(false),
});
const loop = z.object({
  id,
  trigger: z.discriminatedUnion("type", [
    z.object({ type: z.literal("manual") }),
    z.object({
      type: z.literal("schedule"),
      every: z.string().trim().min(1),
      at: z
        .object({
          time: z.string().trim().min(1),
          timezone: z.string().trim().min(1),
        })
        .optional(),
    }),
  ]),
  target: z.object({ kind: z.literal("workflow"), id }),
  input: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export const selfConfigurationPlanSchema = z
  .object({
    outcome: z.string().trim().min(1).max(1_000),
    capabilities: z.array(capability).max(20),
    workflow,
    loop: loop.optional(),
    testInput: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((value) => JSON.stringify(value).length <= 256_000, {
    message: "The configuration plan is too large.",
  });

type Plan = z.infer<typeof selfConfigurationPlanSchema>;
type Json = Record<string, unknown>;

interface Ctx {
  owner: string;
  repo: string;
  listCapabilities(): Promise<unknown>;
  readCapability(slug: string): Promise<unknown>;
  saveCapability(input: Json & { slug: string }): Promise<unknown>;
  removeCapability(slug: string): Promise<unknown>;
  readWorkflow(id: string): Promise<unknown>;
  saveWorkflow(input: Json & { id: string }): Promise<unknown>;
  removeWorkflow(id: string): Promise<unknown>;
  readLoop(id: string): Promise<unknown>;
  saveLoop(input: Json & { id: string }): Promise<unknown>;
  removeLoop(id: string): Promise<unknown>;
  runWorkflow(
    input: { workflowId: string; input: Record<string, unknown> },
    options: { approvedByConfiguration: true },
  ): Promise<unknown>;
  listRuns(limit: number): Promise<unknown>;
  wait(ms: number): Promise<void>;
}

interface Options {
  verificationAttempts?: number;
  verificationIntervalMs?: number;
}

function record(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function errorMessage(value: unknown): string | null {
  const item = record(value);
  if (!item || typeof item.error !== "string") return null;
  return typeof item.message === "string" ? item.message : item.error;
}

function itemFrom(value: unknown, key: string): Json | null {
  const root = record(value);
  return root ? record(root[key]) : null;
}

function slugsFrom(value: unknown): Set<string> {
  const root = record(value);
  const rows =
    root && Array.isArray(root.capabilities) ? root.capabilities : [];
  return new Set(
    rows.flatMap((row) => {
      const value = record(row);
      return value && typeof value.slug === "string" ? [value.slug] : [];
    }),
  );
}

function validatePlan(plan: Plan, installed: Set<string>): string[] {
  const planned = new Set(plan.capabilities.map(({ slug }) => slug));
  const available = new Set([...installed, ...planned]);
  const referenced = new Set([
    ...plan.workflow.capabilities,
    ...plan.workflow.steps.map(({ capability }) => capability),
  ]);
  const issues = [...referenced]
    .filter((slug) => !available.has(slug))
    .map((slug) => `Workflow references missing capability "${slug}".`);
  if (plan.loop && plan.loop.target.id !== plan.workflow.id) {
    issues.push(
      `Loop target "${plan.loop.target.id}" does not match planned workflow "${plan.workflow.id}".`,
    );
  }
  return issues;
}

async function rollback(
  applied: Array<{
    remove(): Promise<unknown>;
    restore: (() => Promise<unknown>) | null;
  }>,
) {
  const errors: string[] = [];
  for (const operation of [...applied].reverse()) {
    const result = await (operation.restore ?? operation.remove)().catch(
      (error) => ({
        error: error instanceof Error ? error.message : "rollback failed",
      }),
    );
    const message = errorMessage(result);
    if (message) errors.push(message);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function terminalRun(value: unknown, runId: string): Json | null {
  const root = record(value);
  const runs = root && Array.isArray(root.runs) ? root.runs : [];
  return runs.map(record).find((run) => run?.id === runId) ?? null;
}

export function createSelfConfigurationTools(ctx: Ctx, options: Options = {}) {
  const attempts = options.verificationAttempts ?? 120;
  const intervalMs = options.verificationIntervalMs ?? 2_000;
  return {
    configure_kody: tool({
      description: `Apply one complete, user-approved self-configuration bundle to ${ctx.owner}/${ctx.repo}, run it once, and verify the real result. Inspect existing definitions first and include only missing or changed configuration. This is the preferred write path when one outcome needs capabilities, a workflow, and an optional schedule together.`,
      inputSchema: selfConfigurationPlanSchema,
      execute: async (plan) => {
        const installed = slugsFrom(await ctx.listCapabilities());
        const issues = validatePlan(plan, installed);
        if (issues.length > 0) {
          return { error: "invalid_configuration_plan", issues };
        }

        const capabilitySnapshots = new Map<string, Json | null>();
        for (const entry of plan.capabilities) {
          capabilitySnapshots.set(
            entry.slug,
            itemFrom(await ctx.readCapability(entry.slug), "capability"),
          );
        }
        const workflowSnapshot = itemFrom(
          await ctx.readWorkflow(plan.workflow.id),
          "workflow",
        );
        const loopSnapshot = plan.loop
          ? itemFrom(await ctx.readLoop(plan.loop.id), "loop")
          : null;

        const applied: Array<{
          remove(): Promise<unknown>;
          restore: (() => Promise<unknown>) | null;
        }> = [];
        const fail = async (result: unknown) => ({
          error: "configuration_apply_failed",
          message: errorMessage(result) ?? "Configuration could not be saved.",
          rollback: await rollback(applied),
        });

        for (const entry of plan.capabilities) {
          const saved = await ctx.saveCapability({
            ...entry,
            contract: `${JSON.stringify(entry.contract, null, 2)}\n`,
          });
          if (errorMessage(saved)) return fail(saved);
          const snapshot = capabilitySnapshots.get(entry.slug) ?? null;
          applied.push({
            remove: () => ctx.removeCapability(entry.slug),
            restore: snapshot
              ? () => ctx.saveCapability({ ...snapshot, slug: entry.slug })
              : null,
          });
        }

        const savedWorkflow = await ctx.saveWorkflow(plan.workflow);
        if (errorMessage(savedWorkflow)) return fail(savedWorkflow);
        applied.push({
          remove: () => ctx.removeWorkflow(plan.workflow.id),
          restore: workflowSnapshot
            ? () =>
                ctx.saveWorkflow({ ...workflowSnapshot, id: plan.workflow.id })
            : null,
        });

        if (plan.loop) {
          const savedLoop = await ctx.saveLoop(plan.loop);
          if (errorMessage(savedLoop)) return fail(savedLoop);
          applied.push({
            remove: () => ctx.removeLoop(plan.loop!.id),
            restore: loopSnapshot
              ? () => ctx.saveLoop({ ...loopSnapshot, id: plan.loop!.id })
              : null,
          });
        }

        const appliedResult = {
          capabilities: plan.capabilities.map(({ slug }) => slug),
          workflow: plan.workflow.id,
          ...(plan.loop ? { loop: plan.loop.id } : {}),
        };
        const started = await ctx.runWorkflow(
          { workflowId: plan.workflow.id, input: plan.testInput },
          { approvedByConfiguration: true },
        );
        const runError = errorMessage(started);
        const run = record(started);
        const runId = run && typeof run.runId === "string" ? run.runId : null;
        if (runError || !runId) {
          return {
            ok: false,
            outcome: plan.outcome,
            applied: appliedResult,
            verification: {
              status: "failed",
              ...(runId ? { runId } : {}),
              summary:
                runError ?? "The first test run did not return a run ID.",
            },
          };
        }

        let observed: Json | null = null;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          observed = terminalRun(await ctx.listRuns(100), runId);
          const status = observed?.status;
          if (
            ["success", "failed", "blocked", "cancelled", "stuck"].includes(
              String(status),
            )
          ) {
            break;
          }
          if (attempt < attempts - 1) await ctx.wait(intervalMs);
        }
        const status =
          typeof observed?.status === "string" ? observed.status : "running";
        return {
          ok: status === "success",
          outcome: plan.outcome,
          applied: appliedResult,
          verification: {
            status,
            runId,
            ...(typeof observed?.summary === "string"
              ? { summary: observed.summary }
              : {}),
          },
        };
      },
    }),
  };
}
