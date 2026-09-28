/**
 * @fileType utility
 * @domain kody
 * @pattern pipeline-definitions
 * @ai-summary Shared Pipeline definition contract. A Pipeline orders reusable
 *   Workflows; it never runs Capabilities directly.
 */

import { slugifyTitle } from "@kody-ade/base/slug";
import { z } from "zod";
import {
  validateWorkflowInputSchema,
  type WorkflowInputSchema,
} from "./workflow-input-schema";

const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const pipelineStepDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  workflow: z.string().trim().min(1).max(80),
  decisionFact: z.string().trim().min(1).max(80).optional(),
});

export type PipelineStepDefinition = z.infer<
  typeof pipelineStepDefinitionSchema
>;

export interface PipelineDefinition {
  name: string;
  inputSchema?: WorkflowInputSchema;
  steps: PipelineStepDefinition[];
  runWithoutApproval?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineDefinitionRecord {
  id: string;
  path: string;
  pipeline: PipelineDefinition;
  source?: "local" | "store";
  readOnly?: boolean;
  runnable?: boolean;
  updatedAt?: string;
  htmlUrl?: string | null;
}

export interface PipelineValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface PipelineDefinitionInput {
  name: string;
  inputSchema?: WorkflowInputSchema;
  steps: PipelineStepDefinition[];
  runWithoutApproval?: boolean;
}

export function isPipelineDefinitionId(value: string): boolean {
  return ID.test(value);
}

export function slugifyPipelineDefinitionId(value: string): string {
  return slugifyTitle(value, { maxLength: 80 }).replace(/[-_]+$/g, "");
}

export function pipelineDefinitionPath(id: string): string {
  if (!isPipelineDefinitionId(id)) {
    throw new Error(`Invalid pipeline id "${id}"`);
  }
  return `pipelines/${id}/pipeline.json`;
}

export function normalizePipelineDefinition(
  value: unknown,
): PipelineDefinition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;

  const parsedSteps = z
    .array(pipelineStepDefinitionSchema)
    .safeParse(raw.steps);
  if (!parsedSteps.success || parsedSteps.data.length === 0) return null;
  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt.trim()
      ? raw.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof raw.updatedAt === "string" && raw.updatedAt.trim()
      ? raw.updatedAt
      : createdAt;
  const inputSchema =
    raw.inputSchema &&
    typeof raw.inputSchema === "object" &&
    !Array.isArray(raw.inputSchema)
      ? (raw.inputSchema as WorkflowInputSchema)
      : undefined;

  return {
    name,
    ...(inputSchema ? { inputSchema } : {}),
    steps: parsedSteps.data,
    ...(raw.runWithoutApproval === true ? { runWithoutApproval: true } : {}),
    createdAt,
    updatedAt,
  };
}

export function buildPipelineDefinition(
  input: PipelineDefinitionInput,
  existing?: PipelineDefinition,
): PipelineDefinition {
  const now = new Date().toISOString();
  return {
    name: input.name.trim(),
    ...(input.inputSchema ? { inputSchema: input.inputSchema } : {}),
    steps: input.steps.map((step) => ({
      id: step.id.trim(),
      workflow: step.workflow.trim(),
      ...(step.decisionFact ? { decisionFact: step.decisionFact.trim() } : {}),
    })),
    ...(input.runWithoutApproval === true ? { runWithoutApproval: true } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function mergePipelineDefinition(
  existing: PipelineDefinition,
  patch: Partial<PipelineDefinitionInput>,
): PipelineDefinition {
  return buildPipelineDefinition(
    {
      name: patch.name ?? existing.name,
      inputSchema: patch.inputSchema ?? existing.inputSchema,
      steps: patch.steps ?? existing.steps,
      runWithoutApproval:
        patch.runWithoutApproval ?? existing.runWithoutApproval,
    },
    existing,
  );
}

export function validatePipelineDefinition(
  pipeline: PipelineDefinition,
  options: { knownWorkflows?: ReadonlySet<string> } = {},
): PipelineValidationIssue[] {
  const issues: PipelineValidationIssue[] = [
    ...validateWorkflowInputSchema(pipeline.inputSchema),
  ];
  if (pipeline.steps.length === 0) {
    issues.push({
      code: "missing_steps",
      path: "steps",
      message: "Pipeline needs at least one Workflow.",
    });
    return issues;
  }
  if (pipeline.steps.length > 50) {
    issues.push({
      code: "too_many_steps",
      path: "steps",
      message: "Pipeline cannot contain more than 50 Workflows.",
    });
  }
  const ids = new Set<string>();
  pipeline.steps.forEach((step, index) => {
    if (!ID.test(step.id)) {
      issues.push({
        code: "invalid_step_id",
        path: `steps[${index}].id`,
        message: `Step id ${step.id} is invalid.`,
      });
    } else if (ids.has(step.id)) {
      issues.push({
        code: "duplicate_step_id",
        path: `steps[${index}].id`,
        message: `Step id ${step.id} is duplicated.`,
      });
    }
    ids.add(step.id);
    if (!ID.test(step.workflow)) {
      issues.push({
        code: "invalid_workflow",
        path: `steps[${index}].workflow`,
        message: `Workflow ${step.workflow} is invalid.`,
      });
    } else if (
      options.knownWorkflows &&
      !options.knownWorkflows.has(step.workflow)
    ) {
      issues.push({
        code: "unknown_workflow",
        path: `steps[${index}].workflow`,
        message: `Workflow ${step.workflow} is not available in this agency.`,
      });
    }
  });
  return issues;
}
