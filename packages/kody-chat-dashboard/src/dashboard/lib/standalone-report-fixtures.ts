/**
 * @fileType utility
 * @domain kody
 * @pattern standalone-report-fixtures
 * @ai-summary Harness shim for the Dashboard reports-files contract. The dashboard
 *   host aliases @dashboard to its own src, where the real Convex-backed
 *   implementation lives; the standalone port-3344 harness resolves here
 *   and gets an in-memory store with the same API surface.
 */

export interface ReportRun {
  id: string;
  path: string;
  generatedAt: string | null;
  htmlUrl: string;
  size: number;
}

export interface ReportFile {
  slug: string;
  path: string;
  runId: string | null;
  runs: ReportRun[];
  title: string;
  body: string;
  updatedAt: string;
  htmlUrl: string;
  size: number;
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

function seedReports(): ReportFile[] {
  const now = new Date().toISOString();
  return [
    {
      slug: "weekly-loop",
      path: "reports/weekly-loop/runs/run-1.md",
      runId: "run-1",
      runs: [
        {
          id: "run-1",
          path: "reports/weekly-loop/runs/run-1.md",
          generatedAt: now,
          htmlUrl:
            "https://github.com/acme/widgets/blob/main/reports/weekly-loop/runs/run-1.md",
          size: 64,
        },
      ],
      title: "Weekly loop",
      body: "Everything green in the fixture universe.",
      updatedAt: now,
      htmlUrl:
        "https://github.com/acme/widgets/blob/main/reports/weekly-loop/runs/run-1.md",
      size: 64,
    },
  ];
}

let reports: ReportFile[] = seedReports();

/** Reset the in-memory report store to its seed — call from test setup. */
export function resetReportFixtures(): void {
  reports = seedReports();
}

export async function listReportFiles(): Promise<ReportFile[]> {
  return reports;
}

export async function readReportFile(
  slug: string,
): Promise<ReportFile | null> {
  return reports.find((r) => r.slug === slug) ?? null;
}

export async function writeReportRun(input: {
  slug: string;
  title: string;
  body: string;
  generatedAt: string;
}): Promise<{ runId: string; path: string }> {
  if (!isValidSlug(input.slug)) {
    throw new Error(`invalid report slug "${input.slug}"`);
  }
  const runId = input.generatedAt.replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  const path = `reports/${input.slug}/runs/${runId}.md`;
  const run: ReportRun = {
    id: runId,
    path,
    generatedAt: input.generatedAt,
    htmlUrl: "",
    size: input.body.length,
  };
  const existing = reports.find((r) => r.slug === input.slug);
  const report: ReportFile = {
    slug: input.slug,
    path,
    runId,
    runs: [run, ...(existing?.runs ?? [])],
    title: input.title,
    body: input.body,
    updatedAt: input.generatedAt,
    htmlUrl: "",
    size: input.body.length,
  };
  reports = [report, ...reports.filter((r) => r.slug !== input.slug)];
  return { runId, path };
}
