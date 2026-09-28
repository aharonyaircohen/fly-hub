import { containsToolCallMarkup } from "@kody-ade/kody-chat-dashboard/core/tool-call-strip";

const REQUIRED_SECTION_COUNT = 11;
const EXECUTIVE_PART_COUNT = 5;
const RISK_PART_COUNT = 4;

const RAW_TOOL_CALL_JSON =
  /(?:^|\n)\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/i;

export type ProjectAssessmentValidationReason =
  | "empty_report"
  | "missing_title"
  | "unfinished_output"
  | "tool_call_output"
  | "missing_section"
  | "empty_section"
  | "missing_executive_part"
  | "missing_risk_part";

export type ProjectAssessmentValidation =
  | { valid: true }
  | {
      valid: false;
      reason: ProjectAssessmentValidationReason;
      detail?: string;
    };

export const INVALID_PROJECT_ASSESSMENT_MESSAGE =
  "Final report writing failed because the report was incomplete. The specialist findings were preserved and can be used for another writing attempt.";

const REPORT_TITLE_RE = /^#(?!#)\s+(.+?)\s*$/m;

export function projectAssessmentTitle(text: string): string | null {
  return REPORT_TITLE_RE.exec(text)?.[1]?.trim() || null;
}

export function projectAssessmentBody(text: string): string {
  return text.replace(REPORT_TITLE_RE, "").replace(/^\s+/, "").trimEnd();
}

export function describeProjectAssessmentValidationFailure(
  validation: Exclude<ProjectAssessmentValidation, { valid: true }>,
): string {
  const label = validation.reason.replaceAll("_", " ");
  const detail = validation.detail ? ` ‘${validation.detail}’` : "";
  return `Final report writing failed: ${label}${detail}. The same-run specialist findings were preserved for a writer-only retry.`;
}

function sectionBodies(text: string): string[] {
  return [...text.matchAll(/^##\s+.+\s*$([\s\S]*?)(?=^##\s+|$(?![\s\S]))/gm)].map(
    (match) => match[1]?.trim() ?? "",
  );
}

function labeledPartCount(text: string): number {
  return (text.match(/^\s*\*\*[^*\n]+:\*\*/gm) ?? []).length;
}

export function validateProjectAssessmentReport({
  text,
  finishReason,
}: {
  text: string;
  finishReason?: string;
}): ProjectAssessmentValidation {
  const report = text.trim();
  if (!report) return { valid: false, reason: "empty_report" };
  if (!projectAssessmentTitle(report)) {
    return { valid: false, reason: "missing_title" };
  }
  if (finishReason && finishReason.toLowerCase() !== "stop") {
    return {
      valid: false,
      reason: "unfinished_output",
      detail: finishReason,
    };
  }
  if (containsToolCallMarkup(report) || RAW_TOOL_CALL_JSON.test(report)) {
    return { valid: false, reason: "tool_call_output" };
  }
  const sections = sectionBodies(report);
  if (sections.length < REQUIRED_SECTION_COUNT) {
    return {
      valid: false,
      reason: "missing_section",
      detail: `${sections.length + 1}`,
    };
  }
  for (const [index, body] of sections.slice(0, REQUIRED_SECTION_COUNT).entries()) {
    if (!body) {
      return { valid: false, reason: "empty_section", detail: `${index + 1}` };
    }
  }
  if (labeledPartCount(sections[0] ?? "") < EXECUTIVE_PART_COUNT) {
    return { valid: false, reason: "missing_executive_part" };
  }
  if (labeledPartCount(sections[2] ?? "") < RISK_PART_COUNT) {
    return { valid: false, reason: "missing_risk_part" };
  }
  return { valid: true };
}
