/**
 * @fileType types
 * @domain triggers
 * @pattern trigger-contract
 * @ai-summary The trigger contract: a configurable rule that reacts to a
 *   system event ("when event X matches, save mapped payload values to
 *   user-state entity Y"). Triggers are brand config in the backend;
 *   the event catalog and this engine are kody code.
 */
import { z } from "zod";

export const TRIGGER_CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "exists",
] as const;

export const triggerConditionSchema = z.object({
  /** Dot path into the event payload, e.g. "viewId". */
  path: z.string().trim().min(1).max(200),
  op: z.enum(TRIGGER_CONDITION_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const eventValueMapSchema = z
  .record(z.string().min(1).max(100), z.string().min(1).max(300))
  .default({});

export const triggerActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("save-user-state"),
    /** Target user-state namespace (entity). */
    namespace: z.string().trim().min(1).max(120),
    /** Target key → event value source. */
    map: eventValueMapSchema,
  }),
  z.object({
    type: z.literal("start-workflow"),
    /** Workflow definition to start when the rule matches. */
    workflowId: z.string().trim().min(1).max(200),
    /** Workflow input key → event value source. */
    inputMap: eventValueMapSchema,
  }),
  z.object({
    type: z.literal("start-pipeline"),
    /** Pipeline definition to start when the rule matches. */
    pipelineId: z.string().trim().min(1).max(200),
    /** Pipeline input key -> event value source. */
    inputMap: eventValueMapSchema,
    /** Optional mapped input field used to keep equivalent runs exclusive. */
    concurrencyKey: z.string().trim().min(1).max(100).optional(),
  }),
]);

export const triggerConfigSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  event: z.string().trim().min(1),
  conditions: z.array(triggerConditionSchema).max(10).default([]),
  action: triggerActionSchema,
});

export const triggersFileSchema = z.object({
  version: z.literal(1).default(1),
  triggers: z.array(triggerConfigSchema).max(200).default([]),
});

export type TriggerCondition = z.infer<typeof triggerConditionSchema>;
export type TriggerAction = z.infer<typeof triggerActionSchema>;
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;
export type TriggersFile = z.infer<typeof triggersFileSchema>;
