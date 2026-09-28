export const DEFAULT_REPORT_TYPE = "general";

const REPORT_TYPE_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export function normalizeReportType(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return REPORT_TYPE_RE.test(normalized) ? normalized : DEFAULT_REPORT_TYPE;
}

export function reportTypeLabel(value: string): string {
  return normalizeReportType(value)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

export function availableReportTypes<T extends { reportType: string }>(
  reports: readonly T[],
): string[] {
  return [...new Set(reports.map((report) => normalizeReportType(report.reportType)))].sort();
}

export function filterReportsByType<T extends { reportType: string }>(
  reports: readonly T[],
  reportType: string | null | undefined,
): T[] {
  if (!reportType) return [...reports];
  const selected = normalizeReportType(reportType);
  return reports.filter(
    (report) => normalizeReportType(report.reportType) === selected,
  );
}
