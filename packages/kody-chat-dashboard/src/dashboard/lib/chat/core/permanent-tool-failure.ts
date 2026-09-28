export interface PermanentToolFailure {
  toolName: string;
  error: string;
  status: number;
  message?: string;
  issues: string[];
}

interface ToolStepLike {
  toolResults?: Array<{ toolName?: string; output?: unknown }>;
}

export function findPermanentToolFailure(
  steps: readonly ToolStepLike[],
): PermanentToolFailure | null {
  for (const step of [...steps].reverse()) {
    for (const result of [...(step.toolResults ?? [])].reverse()) {
      const output = asRecord(result.output);
      const status = output ? Number(output.status) : Number.NaN;
      const error = output && text(output.error);
      if (
        !output ||
        !error ||
        error === "approval_required" ||
        !Number.isInteger(status) ||
        status < 400 ||
        status >= 500
      ) {
        continue;
      }
      return {
        toolName: text(result.toolName) ?? "operation",
        error,
        status,
        ...(text(output.message) ? { message: text(output.message) } : {}),
        issues: Array.isArray(output.issues)
          ? output.issues.map(formatIssue).filter(Boolean)
          : [],
      };
    }
  }
  return null;
}

export function formatPermanentToolFailure(
  failure: PermanentToolFailure,
): string {
  const lines = [
    `I couldn't complete ${failure.toolName}.`,
    `Error: ${failure.message ?? failure.error} (${failure.status})`,
  ];
  if (failure.issues.length > 0) {
    lines.push("Details:", ...failure.issues.map((issue) => `- ${issue}`));
  }
  return lines.join("\n");
}

export function isRecoverableRepositoryReadFailure(
  failure: PermanentToolFailure,
): boolean {
  return /code_search_unavailable|GitHub code search is not ready|capabilities[_ ]api[_ ]unavailable|list_capabilities[^\n]*(?:unavailable|failed)/i.test(
    `${failure.toolName}\n${failure.error}\n${failure.message ?? ""}`,
  );
}

function formatIssue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const issue = asRecord(value);
  if (!issue) return "";
  const path = text(issue.path);
  const message = text(issue.message);
  const code = text(issue.code);
  if (!path && !message && !code) return "";
  return `${path ? `${path}: ` : ""}${message ?? code}${code && message ? ` [${code}]` : ""}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
