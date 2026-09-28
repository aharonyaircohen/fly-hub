const BUILT_IN_WORKFLOW_IDS = ["quality-run"] as const;

export function effectiveActiveWorkflowIds(
  configured: string[] | undefined,
): Set<string> {
  const active = new Set(
    (configured ?? []).filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    ),
  );
  for (const workflowId of BUILT_IN_WORKFLOW_IDS) active.add(workflowId);
  return active;
}

export function isBuiltInWorkflow(workflowId: string): boolean {
  return BUILT_IN_WORKFLOW_IDS.some((candidate) => candidate === workflowId);
}
