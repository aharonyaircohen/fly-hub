import { tool } from "ai";
import { z } from "zod";
import { readableResourceResult } from "./readable-resource-result";

const agencyIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,127}$/);

const guidanceSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

const loopTriggerSchema = z.discriminatedUnion("type", [
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
]);

const loopSchema = z.object({
  id: agencyIdSchema,
  trigger: loopTriggerSchema,
  target: z.object({
    kind: z.enum(["workflow", "capability"]),
    id: agencyIdSchema,
  }),
  input: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

const intentSchema = z.object({
  slug: guidanceSlugSchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(100_000),
  agent: z
    .array(z.string().regex(/^(\*|[a-z0-9][a-z0-9_-]{0,63})$/))
    .min(1)
    .default(["kody"]),
});

interface Ctx {
  owner: string;
  repo: string;
  listLoops(): Promise<unknown>;
  readLoop(loopId: string): Promise<unknown>;
  saveLoop(input: z.infer<typeof loopSchema>): Promise<unknown>;
  removeLoop(loopId: string): Promise<unknown>;
  runLoop(loopId: string): Promise<unknown>;
  listIntents(): Promise<unknown>;
  readIntent(slug: string): Promise<unknown>;
  saveIntent(input: z.infer<typeof intentSchema>): Promise<unknown>;
  removeIntent(slug: string): Promise<unknown>;
  listRuns(limit: number): Promise<unknown>;
  readRun(runId: string, githubRunId?: string): Promise<unknown>;
}

export function createAgencyLifecycleTools(ctx: Ctx) {
  const repoRef = `${ctx.owner}/${ctx.repo}`;
  return {
    list_loops: tool({
      description: `List the Loops configured for ${repoRef} through the Dashboard API.`,
      inputSchema: z.object({}),
      execute: async () => ctx.listLoops(),
    }),
    read_loop: tool({
      description: `Read one Loop from ${repoRef}.`,
      inputSchema: z.object({ loopId: agencyIdSchema }),
      execute: async ({ loopId }) =>
        readableResourceResult(await ctx.readLoop(loopId)),
    }),
    create_or_update_loop: tool({
      description: `Create or update one manual or scheduled Loop in ${repoRef} through the same Dashboard API used by the Loops page.`,
      inputSchema: loopSchema,
      execute: async (input) => ctx.saveLoop(input),
    }),
    remove_loop: tool({
      description: `Remove one Loop from ${repoRef} through the Dashboard API.`,
      inputSchema: z.object({ loopId: agencyIdSchema }),
      execute: async ({ loopId }) => ctx.removeLoop(loopId),
    }),
    run_loop: tool({
      description: `Run one Loop now in ${repoRef} through the Dashboard API.`,
      inputSchema: z.object({ loopId: agencyIdSchema }),
      execute: async ({ loopId }) => ctx.runLoop(loopId),
    }),

    list_intents: tool({
      description: `List this Agency's intent entries in ${repoRef} through the Dashboard API.`,
      inputSchema: z.object({}),
      execute: async () => ctx.listIntents(),
    }),
    read_intent: tool({
      description: `Read one Agency intent entry from ${repoRef}.`,
      inputSchema: z.object({ slug: guidanceSlugSchema }),
      execute: async ({ slug }) =>
        readableResourceResult(await ctx.readIntent(slug)),
    }),
    create_or_update_intent: tool({
      description: `Create or update one Agency intent entry in ${repoRef} through the same Dashboard API used by the Agency page.`,
      inputSchema: intentSchema,
      execute: async (input) => ctx.saveIntent(input),
    }),
    remove_intent: tool({
      description: `Remove one Agency intent entry from ${repoRef} through the Dashboard API.`,
      inputSchema: z.object({ slug: guidanceSlugSchema }),
      execute: async ({ slug }) => ctx.removeIntent(slug),
    }),

    list_agency_runs: tool({
      description: `List immutable Workflow and Loop run history for ${repoRef}.`,
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(50),
      }),
      execute: async ({ limit }) => ctx.listRuns(limit),
    }),
    read_agency_run: tool({
      description: `Read the evidence for one immutable Agency run in ${repoRef}.`,
      inputSchema: z.object({
        runId: z.string().trim().min(1).max(500),
        githubRunId: z.string().trim().min(1).max(40).optional(),
      }),
      execute: async ({ runId, githubRunId }) =>
        ctx.readRun(runId, githubRunId),
    }),
  };
}
