export function cancellationMatches(
  metadata: Record<string, string>,
  input: {
    orgSlug: string;
    workerId?: string;
    taskId?: string;
  },
) {
  return (
    metadata.flyhub_cancel_org === input.orgSlug &&
    Boolean(
      (input.workerId && metadata.flyhub_cancel_worker === input.workerId) ||
      (input.taskId && metadata.flyhub_cancel_task === input.taskId),
    )
  );
}
