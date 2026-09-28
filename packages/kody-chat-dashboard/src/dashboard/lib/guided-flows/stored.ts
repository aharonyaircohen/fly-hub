/**
 * @fileType utility
 * @domain guided-flows
 * @pattern stored-definition-codec
 * @ai-summary Shared parsing for repository-owned GuidedFlow definitions.
 *   Used by the guided-flows route and chat tools so both resolve the same
 *   published flows.
 */
import { z } from "zod";

import type { GuidedFlowDefinition } from "./controller";
import { migrateLegacyGuidedFlowDefinition } from "./authoring";
import { guidedFlowCmsItemsSourceSchema } from "./authoring";
import { guidedFlowFilePickerSchema } from "./authoring";
import {
  GUIDED_FLOW_CONTROL_IDS,
  hasUniqueGuidedFlowControls,
} from "./control-contract";
import { validateGuidedFlowDefinition } from "./validation";

export const GUIDED_FLOW_DEFINITIONS_NAMESPACE = "guided-flow-definitions";

export type StoredGuidedFlowDefinition = GuidedFlowDefinition & {
  readonly archived?: boolean;
};

const storedStepBaseSchema = {
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  explanation: z.string().trim().min(1).max(1_000),
  authoringGoal: z.string().trim().max(1_000).optional(),
  routeId: z.string().trim().max(80).optional(),
  routeParameters: z
    .record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(200))
    .optional(),
  transitions: z.record(z.string(), z.string()).optional(),
  actions: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        target: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("step"),
            stepId: z.string().trim().min(1),
          }),
          z.object({ type: z.literal("complete") }),
          z.object({ type: z.literal("cancel") }),
          z.object({ type: z.literal("stay") }),
        ]),
      }),
    )
    .max(20)
    .optional(),
};

const storedGuidedFlowStepSchema = z.union([
  z.object({
    ...storedStepBaseSchema,
    type: z.literal("flow"),
    flowId: z.string().trim().min(1).max(80),
    flowVersion: z.number().int().positive(),
  }),
  z.object({
    ...storedStepBaseSchema,
    type: z.literal("command"),
    command: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .regex(/^\/[a-z][a-z0-9-]*(?:\s+[^\r\n]+)?$/i),
    waitForCompletion: z.boolean().optional(),
  }),
  z.object({
    ...storedStepBaseSchema,
    type: z.literal("view").optional(),
    rendererSlug: z.string().trim().min(1).max(80),
    rendererVersion: z.number().int().positive().optional(),
    rendererData: z.record(z.string(), z.unknown()).optional(),
    itemsSource: guidedFlowCmsItemsSourceSchema.optional(),
    filePicker: guidedFlowFilePickerSchema.optional(),
    allowedActions: z.array(z.string().trim().min(1).max(80)).optional(),
  }),
]);

export const storedGuidedFlowDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(160),
  source: z
    .object({
      type: z.literal("request-blueprint"),
      id: z.string().trim().min(1).max(80),
      version: z.number().int().positive(),
    })
    .strict()
    .optional(),
  completionRouteId: z.string().trim().max(80).optional(),
  completionRouteParameters: z
    .record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(200))
    .optional(),
  controls: z
    .array(z.enum(GUIDED_FLOW_CONTROL_IDS))
    .max(8)
    .refine(hasUniqueGuidedFlowControls)
    .optional(),
  onComplete: z
    .object({ action: z.literal("agency-request.submit") })
    .strict()
    .optional(),
  archived: z.boolean().optional(),
  steps: z.array(storedGuidedFlowStepSchema).min(1).max(20),
});

/** Parse stored definitions, skipping invalid records. */
export function parseStoredGuidedFlowDefinitions(
  data: unknown,
): StoredGuidedFlowDefinition[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((candidate) => {
    const parsed = storedGuidedFlowDefinitionSchema.safeParse(candidate);
    if (!parsed.success) return [];
    try {
      const definition = migrateLegacyGuidedFlowDefinition(parsed.data);
      validateGuidedFlowDefinition(definition);
      return [definition as StoredGuidedFlowDefinition];
    } catch {
      return [];
    }
  });
}

/**
 * Map guidedFlowDefinitions table rows to stored definitions. The row's
 * version/archived are authoritative; the payload carries the flow shape.
 */
export function parseGuidedFlowDefinitionRows(
  rows: unknown,
): StoredGuidedFlowDefinition[] {
  if (!Array.isArray(rows)) return [];
  const selectedRows = new Map<
    string,
    {
      actorId?: string;
      updatedAt?: string;
      version?: number;
      archived?: boolean;
      definition?: unknown;
    }
  >();
  for (const candidate of rows) {
    const row = candidate as {
      actorId?: string;
      flowId?: string;
      updatedAt?: string;
      version?: number;
      archived?: boolean;
      definition?: unknown;
    } | null;
    if (!row?.flowId || typeof row.version !== "number") continue;
    const key = `${row.flowId}@${row.version}`;
    const current = selectedRows.get(key);
    const candidateIsRepositoryOwned = !row.actorId;
    const currentIsRepositoryOwned = current ? !current.actorId : false;
    if (
      !current ||
      (candidateIsRepositoryOwned && !currentIsRepositoryOwned) ||
      (candidateIsRepositoryOwned === currentIsRepositoryOwned &&
        (row.updatedAt ?? "") > (current.updatedAt ?? ""))
    ) {
      selectedRows.set(key, row);
    }
  }
  return parseStoredGuidedFlowDefinitions(
    [...selectedRows.values()].flatMap((row) => {
      const record = row as {
        version?: number;
        archived?: boolean;
        definition?: unknown;
      } | null;
      if (!record?.definition || typeof record.definition !== "object") {
        return [];
      }
      return [
        {
          ...(record.definition as Record<string, unknown>),
          version: record.version,
          ...(record.archived ? { archived: true } : {}),
        },
      ];
    }),
  );
}

/** Latest version per flow id, including archived tombstones. */
export function latestStoredGuidedFlowDefinitions(
  definitions: readonly StoredGuidedFlowDefinition[],
): StoredGuidedFlowDefinition[] {
  const latest = new Map<string, StoredGuidedFlowDefinition>();
  for (const definition of definitions) {
    const current = latest.get(definition.id);
    if (!current || definition.version > current.version) {
      latest.set(definition.id, definition);
    }
  }
  return [...latest.values()];
}

/** Latest non-archived definitions — the flows a user may start. */
export function latestAvailableGuidedFlowDefinitions(
  definitions: readonly StoredGuidedFlowDefinition[],
): GuidedFlowDefinition[] {
  return latestStoredGuidedFlowDefinitions(definitions)
    .filter((definition) => !definition.archived)
    .map(({ archived: _archived, ...definition }) => definition);
}
