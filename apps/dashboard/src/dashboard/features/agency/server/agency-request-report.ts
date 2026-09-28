import { createHash } from "node:crypto";
import type { AgencyRequestState } from "@kody-ade/agency-domain";
import type { TodoFile } from "@kody-ade/workspace/todos/files";

const REPORT_PREFIX = "agency-request-";

export function agencyRequestReportSlug(todoSlug: string): string {
  const direct = `${REPORT_PREFIX}${todoSlug}`;
  if (direct.length <= 64) return direct;
  const digest = createHash("sha256")
    .update(todoSlug)
    .digest("hex")
    .slice(0, 8);
  const prefixLength = 64 - REPORT_PREFIX.length - digest.length - 1;
  return `${REPORT_PREFIX}${todoSlug.slice(0, prefixLength)}-${digest}`;
}

function scalar(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function label(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function deliveryState(
  status: "success" | "failed" | "blocked",
  output: Readonly<Record<string, unknown>>,
): string {
  if (status !== "success") return "blocked";
  if (output.merged === true) return "merged";
  if (
    output.installed === true ||
    output.activated === true ||
    output.activationStatus === "installed"
  ) {
    return "installed";
  }
  if (
    Object.entries(output).some(
      ([key, value]) =>
        /pull.?request|pr(url|number)?/i.test(key) && scalar(value),
    )
  ) {
    return "proposed";
  }
  return "completed";
}

function bullets(values: readonly string[], fallback: string): string {
  return values.length > 0
    ? values.map((value) => `- ${value}`).join("\n")
    : `- ${fallback}`;
}

export function buildAgencyRequestCompletionReport(input: {
  todo: TodoFile;
  state: AgencyRequestState;
  workflowId: string;
  runId: string;
  status: "success" | "failed" | "blocked";
  summary?: string;
  output?: Readonly<Record<string, unknown>>;
}): string {
  const output = input.output ?? {};
  const blueprintId = input.state.related.find(
    (ref) => ref.kind === "strategy",
  )?.id;
  const blueprintVersion = scalar(
    input.state.execution?.input.blueprintVersion,
  );
  const resultRows = Object.entries(output)
    .map(([key, value]) => {
      const rendered = scalar(value);
      return rendered ? `- **${label(key)}:** ${rendered}` : null;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 30);

  return [
    "- **Type:** agency-request-completion",
    "- **Version:** 1",
    `- **Delivery state:** ${deliveryState(input.status, output)}`,
    `- **Workflow:** ${input.workflowId}`,
    `- **Run:** ${input.runId}`,
    ...(blueprintId ? [`- **Blueprint:** ${blueprintId}`] : []),
    ...(blueprintVersion
      ? [`- **Blueprint version:** ${blueprintVersion}`]
      : []),
    "",
    "## Outcome",
    "",
    input.state.requirement.outcome,
    "",
    "## Work completed",
    "",
    bullets(input.state.plan, "No execution plan was recorded."),
    "",
    "## Verification",
    "",
    bullets(
      [
        ...input.state.evidence,
        ...(input.summary?.trim() ? [input.summary.trim()] : []),
      ],
      "No completion evidence was recorded.",
    ),
    "",
    "## Activated automation",
    "",
    bullets(
      (input.state.execution?.activations ?? []).map(
        (activation) => `${activation.kind}: ${activation.id}`,
      ),
      "No additional automation was activated.",
    ),
    "",
    "## Result details",
    "",
    resultRows.length > 0
      ? resultRows.join("\n")
      : "- No extra result details were supplied.",
    "",
    "## Remaining decisions",
    "",
    bullets(input.state.blockers, "None."),
  ].join("\n");
}
