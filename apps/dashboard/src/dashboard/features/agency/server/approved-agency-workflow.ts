import { randomUUID } from "node:crypto";

import type { AgencyRequestExecution } from "@kody-ade/agency-domain";
import {
  startWorkflow,
  type WorkflowExecutionDependencies,
} from "@dashboard/features/workflows/server/start-workflow";

type DispatchServices = Pick<
  WorkflowExecutionDependencies,
  "loadWorkflow" | "validateDefinition" | "validateInput" | "dispatch"
>;

type Activate = (
  activation: NonNullable<AgencyRequestExecution["activations"]>[number],
) => Promise<{
  configPatch?: Record<string, unknown>;
  files?: Array<{ path: string; content: string }>;
}>;

function mergeConfigPatch(
  current: Record<string, unknown>,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!incoming) return current;
  const next = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const previous = next[key];
    next[key] =
      Array.isArray(previous) && Array.isArray(value)
        ? [...new Set([...previous, ...value])]
        : value;
  }
  return next;
}

export async function prepareApprovedAgencyExecution(
  execution: AgencyRequestExecution,
  activate: Activate,
): Promise<AgencyRequestExecution> {
  const activations = execution.activations ?? [];
  let configPatch: Record<string, unknown> = {};
  const files = new Map<string, string>();
  for (const activation of activations) {
    const result = await activate(activation);
    configPatch = mergeConfigPatch(configPatch, result.configPatch);
    for (const file of result.files ?? []) {
      const existing = files.get(file.path);
      if (existing !== undefined && existing !== file.content) {
        throw new Error(
          `Store activation prepared conflicting file ${file.path}`,
        );
      }
      files.set(file.path, file.content);
    }
  }
  const input =
    activations.length > 0
      ? {
          ...execution.input,
          installation: {
            configPatch,
            ...(files.size > 0
              ? {
                  files: [...files].map(([path, content]) => ({
                    path,
                    content,
                  })),
                }
              : {}),
          },
        }
      : { ...execution.input };
  return { ...execution, input };
}

export async function dispatchApprovedAgencyWorkflow({
  actor,
  execution,
  runId,
  services,
}: {
  actor: string;
  execution: AgencyRequestExecution;
  runId: string;
  services: DispatchServices;
}): Promise<{ runId: string }> {
  const result = await startWorkflow(
    {
      workflowId: execution.workflowId,
      source: "dashboard",
      actor,
      requestId: runId,
      input: { ...execution.input },
    },
    {
      ...services,
      createRequestId: () => `run-${randomUUID()}`,
      now: () => new Date().toISOString(),
      requiresApproval: async () => false,
      consumeApproval: async () => false,
      actionFor: () => "run",
    },
  );
  if (result.kind === "accepted") return { runId: result.requestId };
  if (result.kind === "not-found") {
    throw new Error("The approved Workflow is no longer available");
  }
  if (result.kind === "invalid") {
    throw new Error("The approved Workflow or its input is no longer valid");
  }
  throw new Error("The approved Workflow could not be dispatched");
}
